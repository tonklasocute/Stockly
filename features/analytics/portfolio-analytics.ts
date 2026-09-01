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
import type { Holding, PortfolioSummary, RealizedTrade } from "@/domain/types"
import { listCashTransactions, toDomainCash } from "@/features/cash/queries"
import { listDividends, toDomainDividends } from "@/features/dividends/queries"
import { listTransactions, toDomain } from "@/features/transactions/queries"
import { createClient } from "@/lib/supabase/server"
import { getMarketDataProvider, isMarketDataError, type Quote } from "@/services/market-data"
import type { PortfolioSnapshotRow } from "@/types/database"

export type AnalyticsBundle = {
  holdings: Holding[]
  summary: PortfolioSummary
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
 * tier bills individually. They are fetched concurrently, cached for 24h upstream, and any failure
 * degrades that holding to "Unknown" rather than failing the page.
 */
export const loadAnalytics = cache(
  async (portfolioId: string, grouping: PeriodGrouping = "month"): Promise<AnalyticsBundle> => {
    const [transactionRows, cashRows, dividendRows, snapshots] = await Promise.all([
      listTransactions(portfolioId),
      listCashTransactions(portfolioId),
      listDividends(portfolioId),
      listSnapshots(portfolioId),
    ])

    const domainTransactions = toDomain(transactionRows)
    const domainDividends = toDomainDividends(dividendRows)
    const symbols = [...new Set(transactionRows.map((t) => t.symbol))]

    let quotes = new Map<string, Quote>()
    let facts = new Map<string, SymbolFacts>()
    let marketDataError: string | null = null

    if (symbols.length > 0) {
      const provider = getMarketDataProvider()
      try {
        quotes = await provider.getQuotes(symbols)
      } catch (error) {
        marketDataError = isMarketDataError(error)
          ? error.message
          : "Unable to load market data. Please try again later."
        console.error("[analytics] quotes failed", error)
      }

      // Metadata is optional decoration: a failure here must never cost the user their numbers.
      const profiles = await Promise.all(
        symbols.map((symbol) => provider.getCompanyProfile(symbol).catch(() => null)),
      )
      facts = new Map(
        profiles.filter((p) => p !== null).map((p) => [
          p.symbol,
          { sector: p.sector, industry: p.industry, country: p.country, currency: p.currency },
        ]),
      )
    }

    const { holdings, summary } = buildPortfolio(domainTransactions, (symbol) => {
      const quote = quotes.get(symbol)
      return quote ? { price: quote.price, previousClose: quote.previousClose ?? undefined } : undefined
    })
    const { trades } = replayPortfolio(domainTransactions)

    const cash = computeCash(
      domainTransactions,
      toDomainCash(cashRows),
      domainDividends.map((d) => ({
        netAmount: d.shares * d.dividendPerShare - d.tax - d.fee,
        paidOn: d.paidOn,
      })),
    )

    const factOf = (symbol: string) => facts.get(symbol)
    const sectors = allocateBy(holdings, factOf, "sector")
    const industries = allocateBy(holdings, factOf, "industry")
    const dividendSummary = summarizeDividends(domainDividends)

    return {
      holdings,
      summary,
      trades,
      cash,
      totalValue: add(summary.marketValue, Math.max(cash.balance, 0)),
      allocation: allocateByHolding(holdings, cash.balance),
      sectors,
      industries,
      countries: allocateBy(holdings, factOf, "country"),
      currencies: allocateBy(holdings, factOf, "currency"),
      hasSectorData: sectors.length > 0 && !isAllUnknown(sectors),
      hasIndustryData: industries.length > 0 && !isAllUnknown(industries),
      concentration: computeConcentration(holdings, cash.balance),
      movers: topMovers(holdings),
      today: todayMovers(holdings),
      contribution: computeContribution(holdings, trades),
      tradeStats: computeTradeStatistics(domainTransactions, trades),
      fees: computeFees(domainTransactions),
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
      capital: investedCapitalSeries(domainTransactions),
      performance: performanceSeries(
        snapshots.map((s) => ({
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

  const supabase = await createClient()
  const { error } = await supabase.from("portfolio_snapshots").upsert(
    {
      portfolio_id: portfolioId,
      user_id: userId,
      snapshot_date: new Date().toISOString().slice(0, 10),
      total_value: bundle.totalValue,
      invested_value: bundle.summary.investedValue,
      cash_value: Math.max(bundle.cash.balance, 0),
      realized_pnl: bundle.summary.realizedPnl,
      unrealized_pnl: bundle.summary.unrealizedPnl,
    },
    { onConflict: "portfolio_id,snapshot_date" },
  )

  // A failed snapshot loses one day of history; it must not take down the analytics page.
  if (error) console.error("[analytics] snapshot failed", error)
}

/** Total dividends received per symbol, for the holdings-level views. */
export function dividendTotalBySymbol(bundle: AnalyticsBundle): Record<string, number> {
  return Object.fromEntries(bundle.dividends.bySymbol.map((row) => [row.symbol, row.net]))
}

