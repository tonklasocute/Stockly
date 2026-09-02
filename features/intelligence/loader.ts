import "server-only"

import { cache } from "react"
import { converterTo } from "@/domain/fx"
import { baseCurrencyOf, type Currency } from "@/domain/market"
import {
  moneyWeightedReturn,
  returnIndex,
  simpleReturn,
  subPeriodReturns,
  timeWeightedReturn,
  type ValuationPoint,
} from "@/domain/returns"
import {
  beta,
  concentrationDetail,
  maxDrawdown,
  sharpeRatio,
  volatility,
  MIN_PAIRED_OBSERVATIONS,
  MIN_RETURN_OBSERVATIONS,
  TRADING_DAYS_PER_YEAR,
  type Beta,
  type ConcentrationDetail,
  type Drawdown,
  type Sharpe,
  type Volatility,
} from "@/domain/risk"
import { buildInsights, type Insight } from "@/domain/insights"
import { withProgress, listGoals, type GoalWithProgress } from "@/features/goals/queries"
import { loadAnalytics, type AnalyticsBundle } from "@/features/analytics/portfolio-analytics"
import { listTheses } from "@/features/theses/queries"
import { getBenchmarkProvider, toDefinition, type BenchmarkDefinition } from "@/services/benchmark"
import { loadFxTable } from "@/services/fx"
import { createClient } from "@/lib/supabase/server"
import type { Candle } from "@/services/market-data/types"
import type { ThesisRow } from "@/types/database"
import type { ReviewRange } from "./range"

/**
 * One pass for every intelligence surface.
 *
 * The dashboard shows goal progress, a benchmark line, a drawdown figure and three insights; the
 * review page shows all of it. Loading each card independently would be four passes over the same
 * transactions and four batched quote calls — the N+1 phase 8 went hunting for, one level up. So
 * this is `cache()`d and everything reads from it.
 *
 * **It computes no financial figure of its own.** Holdings, cost basis and P&L come from
 * `loadAnalytics`; returns and risk are pure functions in `domain/`; goals read the same facts the
 * dashboard does. This file is wiring.
 */

export { REVIEW_RANGES, toReviewRange } from "./range"
export type { ReviewRange }

export type BenchmarkComparison = {
  benchmark: BenchmarkDefinition
  /** Time-weighted, so deposits and withdrawals are not counted as performance. */
  portfolioReturnPct: number | null
  benchmarkReturnPct: number | null
  /**
   * Portfolio minus benchmark, in percentage points.
   *
   * **Null when the two are quoted in different currencies.** Subtracting a baht-denominated return
   * from a dollar-denominated one produces a number that is not a difference in anything;
   * translating the benchmark would need a historical exchange rate for every observation, and
   * Stockly stores none. Both returns are still reported, each labelled with its currency.
   */
  differencePct: number | null
  currencyMismatch: { portfolio: Currency; benchmark: Currency } | null
  /** Rebased onto the portfolio's starting value, for the chart. Empty when unavailable. */
  series: Array<{ date: string; value: number }>
  observations: number
  unavailableReason: string | null
}

export type RiskBundle = {
  volatility: Volatility | null
  sharpe: Sharpe | null
  drawdown: Drawdown | null
  beta: Beta | null
  concentration: ConcentrationDetail | null
  /** How many valuation points the measurements above had to work with. */
  observations: number
  /** What is still missing, in plain words, so a null renders an explanation and not a blank. */
  limitations: string[]
}

export type IntelligenceBundle = {
  analytics: AnalyticsBundle
  baseCurrency: Currency
  range: ReviewRange
  /** The valuation points inside the selected range. */
  valuations: ValuationPoint[]
  timeWeightedReturnPct: number | null
  moneyWeightedReturnPct: number | null
  risk: RiskBundle
  benchmark: BenchmarkComparison | null
  goals: GoalWithProgress[]
  theses: ThesisRow[]
  insights: Insight[]
}

/** Where a range starts, in the portfolio's own history. MAX has no start. */
function rangeStart(range: ReviewRange, now: Date): string | null {
  const at = new Date(now)
  switch (range) {
    case "1M":
      at.setUTCMonth(at.getUTCMonth() - 1)
      break
    case "3M":
      at.setUTCMonth(at.getUTCMonth() - 3)
      break
    case "6M":
      at.setUTCMonth(at.getUTCMonth() - 6)
      break
    case "YTD":
      return `${now.getUTCFullYear()}-01-01`
    case "1Y":
      at.setUTCFullYear(at.getUTCFullYear() - 1)
      break
    case "MAX":
      return null
  }
  return at.toISOString().slice(0, 10)
}

/** The provider range that covers a review range, so a benchmark is fetched once and trimmed. */
const PROVIDER_RANGE: Record<ReviewRange, "1M" | "3M" | "6M" | "1Y" | "MAX"> = {
  "1M": "1M",
  "3M": "3M",
  "6M": "6M",
  YTD: "1Y",
  "1Y": "1Y",
  MAX: "MAX",
}

export const loadIntelligence = cache(
  async (portfolioId: string, range: ReviewRange = "1Y"): Promise<IntelligenceBundle> => {
    const now = new Date()
    const analytics = await loadAnalytics(portfolioId)
    const baseCurrency = analytics.baseCurrency

    const start = rangeStart(range, now)
    const valuations = start
      ? analytics.valuations.filter((point) => point.date >= start)
      : analytics.valuations

    // Everything below is a pure function of data already in hand — except the benchmark, which is
    // the one thing that can need the network, and which degrades to null on its own.
    const [goalRows, theses, benchmark] = await Promise.all([
      listGoals(portfolioId),
      listTheses(portfolioId),
      loadBenchmark(portfolioId, range, baseCurrency, valuations),
    ])

    const returns = subPeriodReturns(valuations)?.map((r) => r.ratio) ?? []
    const index = returnIndex(valuations) ?? []
    const twr = timeWeightedReturn(valuations)

    const risk = buildRisk({
      returns,
      index,
      holdings: analytics.holdings,
      // Aligned to the portfolio's own valuation dates, so beta compares like intervals with like.
      benchmarkReturns: benchmark ? alignedBenchmarkReturns(benchmark, valuations) : [],
    })

    const goalFacts = {
      baseCurrency,
      totalValue: analytics.totalValue,
      investedValue: analytics.summary.investedValue,
      trailingTwelveMonthDividends: analytics.dividends.summary.trailingTwelveMonths,
      returnPct: analytics.summary.returnPct,
    }
    // The same rate table the holdings engine used, so a goal in another currency is measured
    // against exactly the figures on the dashboard.
    const fx = await loadFxTable(baseCurrency, [
      ...new Set(goalRows.map((row) => baseCurrencyOf(row.currency ?? baseCurrency))),
    ])
    const convert = converterTo(baseCurrency, fx, now)

    return {
      analytics,
      baseCurrency,
      range,
      valuations,
      timeWeightedReturnPct: twr,
      moneyWeightedReturnPct: moneyWeightedReturn(irrFlows(analytics, now)),
      risk,
      benchmark,
      goals: withProgress(goalRows, goalFacts, { now, convert }),
      theses,
      insights: buildInsights({
        baseCurrency,
        concentration: risk.concentration
          ? {
              largestSymbol: analytics.holdings[0]?.symbol ?? null,
              largestWeightPct: risk.concentration.largestWeightPct,
              topThreeWeightPct: risk.concentration.top3WeightPct,
              effectivePositions: risk.concentration.effectivePositions,
              positions: risk.concentration.positions,
            }
          : null,
        returnPct: analytics.summary.holdingsCount > 0 ? analytics.summary.returnPct : null,
        currentDrawdownPct: risk.drawdown?.currentDrawdownPct ?? null,
        maxDrawdownPct: risk.drawdown?.maxDrawdownPct ?? null,
        benchmark:
          benchmark &&
          benchmark.portfolioReturnPct !== null &&
          benchmark.benchmarkReturnPct !== null &&
          benchmark.differencePct !== null
            ? {
                name: benchmark.benchmark.name,
                portfolioReturnPct: benchmark.portfolioReturnPct,
                benchmarkReturnPct: benchmark.benchmarkReturnPct,
              }
            : null,
        cash: {
          balance: analytics.cash.balance,
          sharePct:
            analytics.totalValue > 0
              ? (Math.max(analytics.cash.balance, 0) / analytics.totalValue) * 100
              : null,
        },
        currencyExposure: analytics.summary.exposures.map((e) => ({
          currency: e.currency,
          weightPct: e.weight,
        })),
        untranslatedHoldings: analytics.summary.untranslatedCount,
        dividends: {
          trailingTwelveMonths: analytics.dividends.summary.trailingTwelveMonths,
          previousTwelveMonths: analytics.dividends.summary.previousTwelveMonths,
        },
        fees: { total: analytics.fees.total, percentOfTurnover: analytics.fees.percentOfTurnover },
        trades: {
          closed: analytics.tradeStats.totalTrades,
          winRatePct: analytics.tradeStats.winRate,
        },
        staleHoldings: analytics.summary.staleCount,
        quoteAgeMinutes: analytics.quoteAgeMinutes,
      }),
    }
  },
)

/**
 * IRR flows: every external movement, plus the portfolio's value today as a closing inflow.
 *
 * The terminal value is what makes the series solvable — without it the flows only ever go one way
 * and no rate satisfies them, which is exactly the `null` `moneyWeightedReturn` would return.
 */
function irrFlows(analytics: AnalyticsBundle, now: Date) {
  if (analytics.capitalFlows.length === 0 || analytics.totalValue <= 0) return []
  return [
    ...analytics.capitalFlows,
    { date: now.toISOString().slice(0, 10), amount: analytics.totalValue },
  ]
}

function buildRisk({
  returns,
  index,
  holdings,
  benchmarkReturns,
}: {
  returns: number[]
  index: Array<{ date: string; index: number }>
  holdings: AnalyticsBundle["holdings"]
  benchmarkReturns: number[]
}): RiskBundle {
  const limitations: string[] = []

  const vol = volatility(returns)
  const drawdown = maxDrawdown(index)
  const concentration = concentrationDetail(
    holdings.map((h) => h.weight).filter((w): w is number => w !== null),
  )

  if (returns.length < MIN_RETURN_OBSERVATIONS) {
    limitations.push(
      `Volatility and Sharpe need at least ${MIN_RETURN_OBSERVATIONS} valuations; this range has ${returns.length}.`,
    )
  }
  if (benchmarkReturns.length === 0) {
    limitations.push("Beta needs a benchmark with history over the same dates.")
  } else if (benchmarkReturns.length < MIN_PAIRED_OBSERVATIONS) {
    limitations.push(
      `Beta needs at least ${MIN_PAIRED_OBSERVATIONS} paired observations; this range has ${benchmarkReturns.length}.`,
    )
  }

  return {
    volatility: vol,
    sharpe: sharpeRatio(returns),
    drawdown,
    // Both series now describe the same intervals, so a length mismatch means the alignment
    // failed and the honest answer is null rather than a silently truncated comparison.
    beta: benchmarkReturns.length === returns.length ? beta(returns, benchmarkReturns) : null,
    concentration,
    observations: returns.length,
    limitations,
  }
}

/**
 * Benchmark returns over **the portfolio's own intervals**.
 *
 * Beta compares two series interval by interval, so they have to be the same intervals. The
 * portfolio is valued on the days a user opened the app; the index has a close for every trading
 * day. Taking the index's own daily returns and pairing them positionally would compare a Tuesday
 * to a fortnight and produce a beta that means nothing.
 *
 * So each valuation date takes the last index close **on or before** it, and the returns are
 * computed between those. A date the index cannot cover — before its history starts, or a stretch
 * with no close at all — drops the whole series rather than being filled in: an interpolated
 * benchmark close is a number no exchange published.
 */
function alignedBenchmarkReturns(
  comparison: BenchmarkComparison,
  valuations: readonly ValuationPoint[],
): number[] {
  const series = comparison.series
  if (series.length < 2 || valuations.length < 2) return []

  const closes: number[] = []
  let cursor = 0
  for (const valuation of valuations) {
    while (cursor + 1 < series.length && series[cursor + 1].date <= valuation.date) cursor += 1
    // The first valuation predates the index history, so there is nothing to compare it against.
    if (series[cursor].date > valuation.date) return []
    closes.push(series[cursor].value)
  }

  const out: number[] = []
  for (let i = 1; i < closes.length; i += 1) {
    if (!(closes[i - 1] > 0)) return []
    out.push(closes[i] / closes[i - 1] - 1)
  }
  return out
}

/**
 * The portfolio's benchmark, if it has one, over the selected range.
 *
 * Every failure mode here ends in a null figure and a sentence, never an omission: no benchmark
 * chosen, a provider whose plan does not carry indices, a series that does not overlap the
 * portfolio's history, or a currency mismatch that makes the difference meaningless.
 */
async function loadBenchmark(
  portfolioId: string,
  range: ReviewRange,
  baseCurrency: Currency,
  valuations: readonly ValuationPoint[],
): Promise<BenchmarkComparison | null> {
  const supabase = await createClient()
  const { data: link } = await supabase
    .from("portfolio_benchmarks")
    .select("benchmark_id")
    .eq("portfolio_id", portfolioId)
    .maybeSingle()

  if (!link) return null

  const { data: row } = await supabase
    .from("benchmarks")
    .select("*")
    .eq("id", link.benchmark_id)
    .maybeSingle()
  if (!row) return null

  const benchmark = toDefinition(row)
  const portfolioReturnPct = timeWeightedReturn(valuations)
  const currencyMismatch =
    benchmark.currency === baseCurrency
      ? null
      : { portfolio: baseCurrency, benchmark: benchmark.currency }

  const empty: BenchmarkComparison = {
    benchmark,
    portfolioReturnPct,
    benchmarkReturnPct: null,
    differencePct: null,
    currencyMismatch,
    series: [],
    observations: 0,
    unavailableReason: null,
  }

  let candles: Candle[] = []
  try {
    candles = await getBenchmarkProvider().getSeries(benchmark, PROVIDER_RANGE[range])
  } catch {
    // The interface says series resolve rather than throw; this is belt and braces so a
    // badly-behaved adapter costs the comparison and not the page.
    candles = []
  }

  if (candles.length === 0) {
    return {
      ...empty,
      unavailableReason: `No index history is available for ${benchmark.name} on this plan.`,
    }
  }

  // Trimmed to the portfolio's own window, so the two returns describe the same period.
  const first = valuations[0]?.date
  const last = valuations[valuations.length - 1]?.date
  const trimmed = first && last
    ? candles.filter((c) => c.date.slice(0, 10) >= first && c.date.slice(0, 10) <= last)
    : candles

  if (trimmed.length < 2) {
    return {
      ...empty,
      unavailableReason:
        "The benchmark has no history over the dates this portfolio was valued on.",
    }
  }

  const benchmarkReturnPct = simpleReturn(trimmed[0].close, trimmed[trimmed.length - 1].close)
  const startValue = valuations[0]?.value ?? 0

  return {
    benchmark,
    portfolioReturnPct,
    benchmarkReturnPct,
    differencePct:
      currencyMismatch === null && portfolioReturnPct !== null && benchmarkReturnPct !== null
        ? Number((portfolioReturnPct - benchmarkReturnPct).toFixed(4))
        : null,
    currencyMismatch,
    series:
      startValue > 0
        ? trimmed.map((c) => ({
            date: c.date.slice(0, 10),
            value: (c.close / trimmed[0].close) * startValue,
          }))
        : [],
    observations: trimmed.length,
    unavailableReason:
      currencyMismatch === null
        ? null
        : `${benchmark.name} is quoted in ${benchmark.currency} and this portfolio is measured in ` +
          `${baseCurrency}. Both returns are shown, but the difference is not, because translating ` +
          "one needs a historical exchange rate Stockly does not store.",
  }
}

export { MIN_RETURN_OBSERVATIONS, MIN_PAIRED_OBSERVATIONS, TRADING_DAYS_PER_YEAR }
