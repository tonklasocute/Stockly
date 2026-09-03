import "server-only"

import { cache } from "react"
import {
  computeGrowth,
  computeMetrics,
  computeTTM,
  type FinancialStatement,
  type FundamentalMetrics,
  type GrowthMetrics,
  type PeriodType,
} from "@/domain/fundamentals"
import { computeValuation, type Valuation } from "@/domain/valuation"
import {
  dedupeEvents,
  dividendFundamentals,
  statusOf,
  type CorporateEvent,
  type DividendFundamentals,
} from "@/domain/corporate-events"
import { currencyOf, type MarketId } from "@/domain/market"
import { freshnessOf, type Freshness } from "@/domain/freshness"
import { coversMarket, getFundamentalProvider } from "@/services/fundamentals"
import { describeError, logger } from "@/lib/log"

/**
 * Everything a fundamental screen needs for one instrument.
 *
 * Three properties this loader is built for:
 *
 * 1. **A provider failure degrades a section, never a page.** Every call is caught; a failure
 *    yields empty data and a reason, and the position, price and holdings on the same screen still
 *    render. Fundamentals are context, not the subject.
 * 2. **"Not configured" and "no data" are different answers.** `covered` says whether this
 *    deployment has a provider for this market at all, so an empty state can name the right cause.
 * 3. **Nothing here touches a portfolio.** The loader takes a symbol and a market, and has no way
 *    to receive a portfolio id — the separation is in the signature.
 */

export type FundamentalBundle = {
  symbol: string
  market: MarketId
  /** False when this deployment has no fundamentals provider for this market. */
  covered: boolean
  providerName: string
  annual: FinancialStatement[]
  quarterly: FinancialStatement[]
  /** Derived from four quarters, never stored — so it cannot disagree with the quarters. */
  ttm: FinancialStatement | null
  /** Metrics for the most recent period Stockly has, whichever type that is. */
  metrics: FundamentalMetrics | null
  metricsPeriodLabel: string | null
  growth: GrowthMetrics | null
  valuation: Valuation | null
  events: CorporateEvent[]
  dividends: DividendFundamentals | null
  /** When the newest statement was fetched, and whether that is recent enough to present as current. */
  fetchedAt: string | null
  freshness: Freshness
  /** Set when nothing could be loaded, so the UI explains rather than showing a blank. */
  unavailableReason: string | null
}

const EMPTY = (symbol: string, market: MarketId, covered: boolean, providerName: string, reason: string | null): FundamentalBundle => ({
  symbol,
  market,
  covered,
  providerName,
  annual: [],
  quarterly: [],
  ttm: null,
  metrics: null,
  metricsPeriodLabel: null,
  growth: null,
  valuation: null,
  events: [],
  dividends: null,
  fetchedAt: null,
  freshness: "UNAVAILABLE",
  unavailableReason: reason,
})

/**
 * `cache()`d so the instrument page, its events section and its valuation panel share one pass.
 *
 * The price is passed in rather than fetched: the page has already made the quote call, and a
 * second one here would be a provider credit spent to learn something the caller is holding.
 */
export const loadFundamentals = cache(
  async (
    symbol: string,
    market: MarketId,
    price: number | null,
  ): Promise<FundamentalBundle> => {
    const provider = getFundamentalProvider()

    if (!coversMarket(market)) {
      return EMPTY(
        symbol,
        market,
        false,
        provider.name,
        provider.capabilities.markets.length === 0
          ? "This deployment has no fundamental data provider configured."
          : `Stockly's fundamental data provider does not cover ${market}.`,
      )
    }

    /*
     * Four independent calls, in parallel, each degrading on its own.
     *
     * `Promise.allSettled` rather than `all`: a provider that has annual statements but no events
     * should produce a page with financials and an empty events section, not an empty page.
     */
    const [annualResult, quarterlyResult, sharesResult, eventsResult, dividendsResult] =
      await Promise.allSettled([
        provider.getFinancialStatements({ symbol, market, periodType: "ANNUAL" as PeriodType, limit: 6 }),
        provider.getFinancialStatements({ symbol, market, periodType: "QUARTERLY" as PeriodType, limit: 8 }),
        provider.getSharesOutstanding(symbol, market),
        provider.getCorporateEvents(symbol, market),
        provider.getDividendHistory(symbol, market),
      ])

    const settled = <T,>(result: PromiseSettledResult<T>, fallback: T, what: string): T => {
      if (result.status === "fulfilled") return result.value
      // Logged with a code, never with the provider's response body.
      logger.warn("fundamentals.fetch_failed", { symbol, market, what, ...describeError(result.reason) })
      return fallback
    }

    const annual = settled(annualResult, [] as FinancialStatement[], "statements.annual")
    const quarterly = settled(quarterlyResult, [] as FinancialStatement[], "statements.quarterly")
    const sharesOutstanding = settled(sharesResult, null as number | null, "shares")
    const events = dedupeEvents(settled(eventsResult, [] as CorporateEvent[], "events"))
    const payments = settled(dividendsResult, [], "dividends")

    if (annual.length === 0 && quarterly.length === 0 && events.length === 0) {
      return EMPTY(symbol, market, true, provider.name, "No fundamental data is available for this instrument.")
    }

    const ttm = computeTTM(quarterly.slice(0, 4))
    // The most recent period Stockly can stand behind: TTM when four quarters exist, else the
    // newest annual. Whichever it is, its label travels with the metrics.
    const primary = ttm ?? annual[0] ?? quarterly[0] ?? null

    const now = new Date()
    const dividendPayments = payments.map((p) => ({ date: p.exDate, amountPerShare: p.amountPerShare }))
    const dividends = dividendPayments.length > 0
      ? dividendFundamentals(dividendPayments, primary?.income.epsDiluted ?? primary?.income.eps ?? null, now)
      : null

    const fetchedAt = primary?.fetchedAt ?? null
    const ageMinutes = fetchedAt === null ? null : (now.getTime() - Date.parse(fetchedAt)) / 60_000

    return {
      symbol,
      market,
      covered: true,
      providerName: provider.name,
      annual,
      quarterly,
      ttm,
      metrics: primary ? computeMetrics(primary) : null,
      metricsPeriodLabel: primary ? (ttm ? "TTM" : `FY${primary.period.fiscalYear}`) : null,
      // Year on year, and only between comparable periods — the engine refuses the rest.
      growth: annual.length >= 2 ? computeGrowth(annual[0], annual[1]) : null,
      valuation: primary
        ? computeValuation({
            price,
            sharesOutstanding,
            statement: primary,
            dividendPerShare: dividends?.trailingPerShare ?? null,
            priceCurrency: currencyOf(market),
          })
        : null,
      events: events.map((event) => ({ ...event, status: statusOf(event, now) })),
      dividends,
      fetchedAt,
      /*
       * Fundamentals use the snapshot policy, not the quote policy.
       *
       * A company reports quarterly; a statement fetched an hour ago is not stale in any sense that
       * matters, and applying the fifteen-minute quote threshold would label every fundamental
       * figure delayed. `domain/freshness.ts` is where that decision lives.
       */
      freshness: freshnessOf(ageMinutes, "snapshot"),
      unavailableReason: null,
    }
  },
)
