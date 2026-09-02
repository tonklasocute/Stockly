import "server-only"

import { cache } from "react"
import {
  allocateBy,
  allocateByHolding,
  computeConcentration,
  computeContribution,
  computeFees,
  computeTradeStatistics,
  investedCapitalSeries,
  isAllUnknown,
  performanceSeries,
  todayMovers,
  topMovers,
  translateTrades,
  translateTransactions,
  type AllocationSlice,
  type CapitalPoint,
  type Concentration,
  type FeeStatistics,
  type Mover,
  type PerformancePoint,
  type SymbolFacts,
  type TradeStatistics,
} from "@/domain/analytics"
import { computeCash, type CashSummary } from "@/domain/cash"
import {
  computeYields,
  dividendsBySymbol,
  groupDividends,
  summarizeDividends,
  type DividendBySymbol,
  type DividendPeriod,
  type DividendSummary,
  type PeriodGrouping,
} from "@/domain/dividends"
import { add } from "@/domain/money"
import { buildPortfolio, replayPortfolio } from "@/domain/holdings"
import { converterTo } from "@/domain/fx"
import type { DatedFlow, ValuationPoint } from "@/domain/returns"
import { baseCurrencyOf, currencyOf, symbolKey, type Currency, type MarketId } from "@/domain/market"
import type { Holding, PortfolioSummary, RealizedTrade } from "@/domain/types"
import { listCashTransactions, toDomainCash } from "@/features/cash/queries"
import { listDividends, toDomainDividends } from "@/features/dividends/queries"
import { listTransactions, toDomain } from "@/features/transactions/queries"
import { dedupeInstruments } from "@/features/portfolios/portfolio-view"
import { createClient } from "@/lib/supabase/server"
import { loadFxTable } from "@/services/fx"
import { getMarketDataProvider, getQuotesFor, type Quote } from "@/services/market-data"
import type { PortfolioSnapshotRow } from "@/types/database"
import { describeError, logger } from "@/lib/log"

export type AnalyticsBundle = {
  holdings: Holding[]
  summary: PortfolioSummary
  /**
   * The portfolio's base currency. **Every money figure in this bundle is in it** — summary, cash,
   * allocation, dividends, fees and contribution alike — except `holdings[].marketValue` and its
   * siblings, which stay in each instrument's own currency and carry `base*` twins beside them.
   */
  baseCurrency: Currency
  /** Markets whose price provider failed. The rest of the portfolio is still priced. */
  staleMarkets: MarketId[]
  /** Currency pairs the FX provider could not answer. Their figures are null, never 0. */
  missingFxPairs: readonly string[]
  trades: RealizedTrade[]
  cash: CashSummary
  /** Stock market value + cash. The number that answers "what is this portfolio worth". */
  totalValue: number
  allocation: AllocationSlice[]
  sectors: AllocationSlice[]
  industries: AllocationSlice[]
  countries: AllocationSlice[]
  currencies: AllocationSlice[]
  /** Set when the provider gave no metadata at all, so those sections can be hidden. */
  hasSectorData: boolean
  hasIndustryData: boolean
  /**
   * Held instruments the provider returned no sector for.
   *
   * Named here rather than inferred from the "Unknown" allocation slice, which knows a total but
   * not which holdings produced it. The data-quality scan needs the names.
   */
  holdingsWithoutMetadata: Array<{ symbol: string; market: MarketId }>
  concentration: Concentration
  movers: { gainers: Mover[]; losers: Mover[] }
  today: { gainers: Mover[]; losers: Mover[] } | null
  contribution: ReturnType<typeof computeContribution>
  tradeStats: TradeStatistics
  fees: FeeStatistics
  dividends: {
    summary: DividendSummary
    byPeriod: DividendPeriod[]
    bySymbol: DividendBySymbol[]
    yieldOnValue: number | null
    yieldOnCost: number | null
  }
  capital: CapitalPoint[]
  performance: PerformancePoint[]
  /**
   * Flow-adjusted valuation points, in the base currency: what return and risk measurement read.
   *
   * Built here rather than in a second loader because the snapshots and the cash movements were
   * already fetched for the figures above — a separate pass would be two more queries for data
   * this function is holding.
   */
  valuations: ValuationPoint[]
  /**
   * External capital movements in the base currency, signed for an IRR solver: money **into** the
   * portfolio is negative. A movement with no exchange rate is dropped, like everywhere else.
   */
  capitalFlows: DatedFlow[]
  /** Age of the oldest quote behind these figures, in minutes. Null when nothing was priced. */
  quoteAgeMinutes: number | null
  /** When that quote was taken, ISO 8601 — so a page can print it without recomputing a clock. */
  quoteAsOf: string | null
  quotes: Map<string, Quote>
  marketDataError: string | null
  transactionCount: number
}

/**
 * Everything the analytics page needs, computed once per request.
 *
 * `cache()` deduplicates within a single render, so the page and its sections share one pass over
 * the database and one batched quote call — not one per section.
 *
 * Company metadata (sector, industry, country) costs one profile call per symbol, which the free
 * tier bills individually — so it is fetched only for symbols that are currently held, not for
 * every symbol ever traded. See the comment at the call site.
 */
export const loadAnalytics = cache(
  async (portfolioId: string, grouping: PeriodGrouping = "month"): Promise<AnalyticsBundle> => {
    const [portfolio, transactionRows, cashRows, dividendRows, snapshots] = await Promise.all([
      readPortfolio(portfolioId),
      listTransactions(portfolioId),
      listCashTransactions(portfolioId),
      listDividends(portfolioId),
      listSnapshots(portfolioId),
    ])

    const baseCurrency = baseCurrencyOf(portfolio?.currency)
    /**
     * Only the snapshots taken in the currency the page is being shown in.
     *
     * A snapshot is the one figure Stockly cannot recompute, so a row written when the portfolio was
     * kept in dollars stays a dollar figure forever. Plotting it beside a baht row would put a
     * thirty-two-fold cliff in the performance chart on the day the setting changed and label it
     * performance. Switching base currency starts a fresh series; the old rows are kept, because
     * they are still true about the currency they were taken in.
     */
    const ownSnapshots = snapshots.filter((row) => baseCurrencyOf(row.currency) === baseCurrency)
    const domainTransactions = toDomain(transactionRows)
    const domainDividends = toDomainDividends(dividendRows)
    const instruments = dedupeInstruments(transactionRows)

    let facts = new Map<string, SymbolFacts>()

    // Quotes (one batched call per market) and rates (one call per currency pair) are independent
    // and neither can take the page down.
    const [priced, fx] = await Promise.all([
      instruments.length > 0
        ? getQuotesFor(instruments)
        : Promise.resolve({ quotes: new Map<string, Quote>(), failed: [] as MarketId[], error: null }),
      loadFxTable(baseCurrency, [...new Set(instruments.map((i) => currencyOf(i.market)))]),
    ])

    const quotes = priced.quotes
    const marketDataError = priced.error?.message ?? null
    const convert = converterTo(baseCurrency, fx, new Date())

    const { holdings, summary } = buildPortfolio(
      domainTransactions,
      (symbol, market) => {
        const quote = quotes.get(symbolKey(symbol, market))
        return quote ? { price: quote.price, previousClose: quote.previousClose ?? undefined } : undefined
      },
      { baseCurrency, convert },
    )
    const { trades } = replayPortfolio(domainTransactions)

    /**
     * Everything below this line is stated in the base currency.
     *
     * Fees, invested-capital history and realized-trade statistics all sum money across rows, and a
     * sum that mixes baht with dollars is not money in any currency. Restating the rows once here
     * keeps those functions the plain arithmetic they were, and puts the single point where an
     * exchange rate is applied somewhere it can be reasoned about — see `domain/analytics.ts`.
     */
    const baseTransactions = translateTransactions(domainTransactions, convert)
    const baseTrades = translateTrades(trades, convert)

    // Company metadata, for the symbols that are actually **held**.
    //
    // This is the one unbatched fan-out in the application: the provider bills a profile per symbol
    // and offers no batch endpoint. Scoping it to open positions is what keeps it affordable — a
    // user who has traded two hundred tickers over the years holds a dozen, and fetching the other
    // hundred and eighty-eight bought nothing: sector, industry and country allocation are computed
    // over holdings, and a closed position appears in none of them.
    //
    // Concurrent, cached upstream for 24h, and individually fault-tolerant: a failure degrades that
    // holding to "Unknown" and keeps it in the totals rather than dropping it from a chart.
    if (holdings.length > 0) {
      const profiles = await Promise.all(
        holdings.map(async (holding) => {
          try {
            // Selecting the provider can itself throw — an unconfigured key, or a market this
            // deployment has no adapter for. Inside the try, so it degrades this holding to
            // "Unknown" like any other profile failure rather than emptying the whole chart.
            return await getMarketDataProvider(holding.market).getCompanyProfile(
              holding.symbol,
              holding.market,
            )
          } catch {
            return null
          }
        }),
      )
      facts = new Map(
        profiles.filter((p) => p !== null).map((p) => [
          p.symbol,
          {
            sector: p.sector,
            industry: p.industry,
            country: p.country,
            // The market's currency, not the provider's guess: it is what the numbers were
            // computed against, so a currency allocation must agree with the holdings table.
            currency: currencyOf(p.market),
          },
        ]),
      )
    }

    /**
     * Cash is the one place a currency is genuinely stored rather than derived: a portfolio can
     * hold a dollar balance and a baht balance at once. Each movement is translated from the
     * currency it is recorded in; a movement with no rate is dropped rather than counted at par,
     * and shows up as a smaller balance the FX banner already explains.
     */
    // Restated once, and reused: the cash balance, the valuation points and the IRR flows are all
    // the same movements seen three ways, so converting them more than once could only introduce a
    // disagreement between them.
    const baseFlows = toDomainCash(cashRows)
      .map((row) => {
        const converted = convert(row.amount, row.currency)
        return converted ? { ...row, amount: converted.value } : null
      })
      .filter((row) => row !== null)

    const cash = computeCash(
      baseTransactions,
      baseFlows,
      domainDividends
        .map((d) => {
          const net = d.shares * d.dividendPerShare - d.tax - d.fee
          const converted = convert(net, d.currency)
          return converted ? { netAmount: converted.value, paidOn: d.paidOn } : null
        })
        .filter((row) => row !== null),
    )

    const factOf = (symbol: string) => facts.get(symbol)
    const sectors = allocateBy(holdings, factOf, "sector")
    const industries = allocateBy(holdings, factOf, "industry")
    const dividendSummary = summarizeDividends(domainDividends)

    return {
      holdings,
      summary,
      baseCurrency,
      staleMarkets: priced.failed,
      missingFxPairs: fx.missing,
      // Native-currency trades: each row carries the currency it was made in, so a table can show
      // "+฿4,200" honestly instead of a translated approximation.
      trades,
      cash,
      totalValue: add(summary.marketValue, Math.max(cash.balance, 0)),
      allocation: allocateByHolding(holdings, cash.balance),
      sectors,
      industries,
      countries: allocateBy(holdings, factOf, "country"),
      currencies: allocateBy(holdings, factOf, "currency"),
      hasSectorData: sectors.length > 0 && !isAllUnknown(sectors),
      holdingsWithoutMetadata: holdings
        .filter((holding) => {
          const fact = facts.get(holding.symbol)
          return !fact?.sector && !fact?.industry && !fact?.country
        })
        .map((holding) => ({ symbol: holding.symbol, market: holding.market })),
      hasIndustryData: industries.length > 0 && !isAllUnknown(industries),
      concentration: computeConcentration(holdings, cash.balance),
      movers: topMovers(holdings),
      today: todayMovers(holdings),
      contribution: computeContribution(holdings, baseTrades),
      tradeStats: computeTradeStatistics(baseTransactions, baseTrades),
      fees: computeFees(baseTransactions),
      dividends: {
        summary: dividendSummary,
        byPeriod: groupDividends(domainDividends, grouping),
        bySymbol: dividendsBySymbol(domainDividends),
        ...computeYields(
          dividendSummary.trailingTwelveMonths,
          summary.marketValue,
          summary.investedValue,
        ),
      },
      capital: investedCapitalSeries(baseTransactions),
      valuations: buildValuations(ownSnapshots, baseFlows),
      capitalFlows: baseFlows.map((flow) => ({
        date: flow.occurredOn,
        // An IRR solver reads money paid in as negative and money taken out as positive.
        amount: flow.kind === "deposit" ? -flow.amount : flow.amount,
      })),
      quoteAgeMinutes: oldestQuote(quotes)?.ageMinutes ?? null,
      quoteAsOf: oldestQuote(quotes)?.asOf ?? null,
      performance: performanceSeries(
        ownSnapshots.map((s) => ({
          date: s.snapshot_date.slice(0, 10),
          totalValue: s.total_value,
          investedValue: s.invested_value,
          cashValue: s.cash_value,
          realizedPnl: s.realized_pnl,
          unrealizedPnl: s.unrealized_pnl,
        })),
      ),
      quotes,
      marketDataError,
      transactionCount: transactionRows.length,
    }
  },
)

/**
 * Snapshots and cash movements joined into the series return measurement needs.
 *
 * Each point carries the **net external capital that arrived since the previous point**, so the
 * flow is attributed to the interval it landed in. Snapshots are written when a user opens the app,
 * so an interval can span several days and a deposit inside one is treated as arriving at its end —
 * the standard approximation, stated in `domain/returns.ts` rather than hidden here.
 *
 * Movements before the first snapshot are excluded: there is no prior valuation to measure them
 * against, and folding them into the first interval would report the initial funding of the account
 * as a loss.
 */
function buildValuations(
  snapshots: readonly PortfolioSnapshotRow[],
  flows: readonly { occurredOn: string; kind: "deposit" | "withdrawal"; amount: number }[],
): ValuationPoint[] {
  const ordered = [...snapshots].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date))
  if (ordered.length === 0) return []

  return ordered.map((snapshot, index) => {
    const date = snapshot.snapshot_date.slice(0, 10)
    const previous = index === 0 ? null : ordered[index - 1].snapshot_date.slice(0, 10)
    const inInterval =
      previous === null
        ? []
        : flows.filter((f) => f.occurredOn > previous && f.occurredOn <= date)

    return {
      date,
      value: Number(snapshot.total_value),
      flow: inInterval.reduce(
        (total, f) => total + (f.kind === "deposit" ? f.amount : -f.amount),
        0,
      ),
    }
  })
}

/**
 * The oldest quote behind these figures: how old, and when it was taken.
 *
 * Both, because a page needs the age to decide whether to warn and the timestamp to print — and
 * reconstructing one from the other at render time would read the clock twice and get two answers.
 */
function oldestQuote(quotes: Map<string, Quote>): { ageMinutes: number; asOf: string } | null {
  const timestamps = [...quotes.values()]
    .map((quote) => Date.parse(quote.asOf))
    .filter((at) => !Number.isNaN(at))
  if (timestamps.length === 0) return null
  const oldest = Math.min(...timestamps)
  return {
    ageMinutes: Math.max(0, (Date.now() - oldest) / 60_000),
    asOf: new Date(oldest).toISOString(),
  }
}

/** The portfolio row itself, for its base currency. RLS scopes it; a missing row falls back to USD. */
async function readPortfolio(portfolioId: string): Promise<{ currency: string } | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("portfolios")
    .select("currency")
    .eq("id", portfolioId)
    .maybeSingle()
  return data ?? null
}

async function listSnapshots(portfolioId: string): Promise<PortfolioSnapshotRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("portfolio_snapshots")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("snapshot_date", { ascending: true })

  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    total_value: Number(row.total_value),
    invested_value: Number(row.invested_value),
    cash_value: Number(row.cash_value),
    realized_pnl: Number(row.realized_pnl),
    unrealized_pnl: Number(row.unrealized_pnl),
  }))
}

/**
 * Snapshot strategy: write-on-read, once a day, idempotently.
 *
 * Why not a cron: Vercel Cron would have to fan out over every portfolio of every user and fetch a
 * quote for each symbol — at 8 credits a minute that is a nightly job that cannot finish, for users
 * who may not open the app that week. Why not on-transaction: a portfolio's value changes with the
 * market, not with the user's typing, so it would miss every day nobody traded.
 *
 * Each row records the base currency it was taken in, and the chart reads only the rows matching the
 * portfolio's current one — see the filter in `loadAnalytics`.
 *
 * Write-on-read costs nothing extra — the quotes were fetched to render the page anyway — and
 * captures a day precisely when the user cared about it. The unique constraint on
 * (portfolio_id, snapshot_date) makes a reload refresh today's row rather than duplicate it.
 *
 * `ponytail:` ceiling — history only accumulates on days the user visits. If gap-free daily history
 * ever matters, add a Vercel Cron route that calls this for recently-active portfolios; the upsert
 * below is already idempotent, so nothing else changes.
 */
export async function recordSnapshot(
  portfolioId: string,
  userId: string,
  bundle: AnalyticsBundle,
): Promise<void> {
  // A portfolio with no transactions has nothing worth a row.
  if (bundle.transactionCount === 0) return
  // Never snapshot a value derived from fallback prices — it would bake a wrong day into history.
  if (bundle.marketDataError || bundle.summary.staleCount > 0) return
  // Nor one that is missing holdings for want of an exchange rate. A snapshot is the only figure
  // Stockly cannot recompute later, so a total that silently excluded a position would become a
  // permanent dip in the performance chart with nothing left to explain it.
  if (bundle.summary.untranslatedCount > 0) return

  const supabase = await createClient()
  const { error } = await supabase.from("portfolio_snapshots").upsert(
    {
      portfolio_id: portfolioId,
      user_id: userId,
      snapshot_date: new Date().toISOString().slice(0, 10),
      // Stamped, so the chart can tell a dollar row from a baht one rather than plotting both.
      currency: bundle.baseCurrency,
      total_value: bundle.totalValue,
      invested_value: bundle.summary.investedValue,
      cash_value: Math.max(bundle.cash.balance, 0),
      realized_pnl: bundle.summary.realizedPnl,
      unrealized_pnl: bundle.summary.unrealizedPnl,
    },
    { onConflict: "portfolio_id,snapshot_date" },
  )

  // A failed snapshot loses one day of history; it must not take down the analytics page.
  if (error) logger.error("analytics.snapshot_failed", describeError(error))
}

/** Total dividends received per symbol, for the holdings-level views. */
export function dividendTotalBySymbol(bundle: AnalyticsBundle): Record<string, number> {
  return Object.fromEntries(bundle.dividends.bySymbol.map((row) => [row.symbol, row.net]))
}

