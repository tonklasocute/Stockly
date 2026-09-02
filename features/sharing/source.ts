import "server-only"

import { allocateByMarket } from "@/domain/analytics"
import { GOAL_DEFINITIONS } from "@/domain/goals"
import { returnIndex } from "@/domain/returns"
import type { AllocationEntry, ShareSource } from "@/domain/sharing"
import type { AllocationSlice } from "@/domain/analytics"
import type { IntelligenceBundle } from "@/features/intelligence/loader"

/**
 * Turns one loaded intelligence pass into the narrow structure the projector accepts.
 *
 * **No figure is calculated here.** Every number is read from the bundle the dashboard reads, which
 * is the whole reason a shared page cannot disagree with the owner's own screen. The work this
 * function does is selection and renaming — deciding which of the engine's outputs are even
 * *capable* of being shared, before the owner's settings decide which of those actually are.
 *
 * The performance series is the one transformation, and it is a deliberate one: the flow-adjusted
 * return index rebased to 100. An index carries the shape of the performance and none of the
 * portfolio's size, so a shared chart cannot be read backwards into an account balance.
 */
export function toShareSource(bundle: IntelligenceBundle, portfolioName: string): ShareSource {
  const { analytics } = bundle
  const { summary, dividends } = analytics

  const index = returnIndex(bundle.valuations)

  return {
    portfolioName,
    baseCurrency: bundle.baseCurrency,
    // The age of the prices behind the figures, not the moment this ran. A page that printed
    // "calculated now" over a quote taken forty minutes ago would be the exact dishonesty the
    // freshness fields below exist to prevent.
    calculatedAt: analytics.quoteAsOf ?? new Date().toISOString(),

    freshness: {
      marketDataStale: summary.staleCount > 0 || analytics.marketDataError !== null,
      staleMarkets: analytics.staleMarkets,
      missingFxPairs: analytics.missingFxPairs,
      untranslatedCount: summary.untranslatedCount,
    },

    overview: {
      totalValue: analytics.totalValue,
      investedValue: summary.investedValue,
      cashValue: analytics.cash.balance,
      unrealizedPnl: summary.unrealizedPnl,
      realizedPnl: summary.realizedPnl,
      returnPct: summary.returnPct,
      todayReturnPct: summary.todayReturnPct,
      holdingsCount: summary.holdingsCount,
    },

    holdings: analytics.holdings
      .filter((holding) => holding.quantity > 0)
      .map((holding) => ({
        symbol: holding.symbol,
        market: holding.market,
        currency: holding.currency,
        quantity: holding.quantity,
        // Nullable all the way out: a holding no exchange rate reached is unknown in the base
        // currency, and the public page renders N/A exactly as the owner's does.
        baseMarketValue: holding.baseMarketValue,
        weightPct: holding.weight,
        unrealizedPnl: holding.unrealizedPnl,
        returnPct: holding.returnPct,
        stale: holding.stale,
      }))
      .sort((a, b) => (b.weightPct ?? -1) - (a.weightPct ?? -1)),

    allocation: analytics.allocation.map(toEntry),
    markets: allocateByMarket(analytics.holdings).map(toEntry),
    currencies: analytics.currencies.map(toEntry),

    performance: {
      timeWeightedReturnPct: bundle.timeWeightedReturnPct,
      moneyWeightedReturnPct: bundle.moneyWeightedReturnPct,
      range: bundle.range,
      series: (index ?? []).map((point) => ({ date: point.date, index: point.index * 100 })),
    },

    benchmark: bundle.benchmark
      ? {
          name: bundle.benchmark.benchmark.name,
          portfolioReturnPct: bundle.benchmark.portfolioReturnPct,
          benchmarkReturnPct: bundle.benchmark.benchmarkReturnPct,
          differencePct: bundle.benchmark.differencePct,
          unavailableReason: bundle.benchmark.unavailableReason,
        }
      : null,

    risk: {
      volatilityPct: bundle.risk.volatility?.annualisedPct ?? null,
      maxDrawdownPct: bundle.risk.drawdown?.maxDrawdownPct ?? null,
      sharpe: bundle.risk.sharpe?.ratio ?? null,
      beta: bundle.risk.beta?.beta ?? null,
      topWeightPct: bundle.risk.concentration?.largestWeightPct ?? null,
      observations: bundle.risk.observations,
      limitations: bundle.risk.limitations,
    },

    income: {
      trailingTwelveMonths: dividends.summary.trailingTwelveMonths,
      yieldOnValuePct: dividends.yieldOnValue,
      yieldOnCostPct: dividends.yieldOnCost,
    },

    /**
     * The goal's **type**, never its note. A note is the owner's own words about their money — the
     * same category of content as a journal entry, and it has no route out of here.
     */
    goals: bundle.goals.map((goal) => ({
      label: GOAL_DEFINITIONS[goal.row.type].label,
      progressPct: goal.progress.progressPct,
      targetLabel: describeTarget(goal.progress),
    })),

    // Already checked against FORBIDDEN_INSIGHT_PATTERNS when they were generated, so a public page
    // inherits that guarantee rather than restating it. Insights describe; they never advise.
    insights: bundle.insights.map((insight) => ({
      code: insight.code,
      title: insight.title,
      detail: insight.detail,
    })),
  }
}

function toEntry(slice: AllocationSlice): AllocationEntry {
  return { key: slice.key, label: slice.label, weightPct: slice.weight }
}

/** A short, human description of what the goal is aiming at. Only ever shown with amounts on. */
function describeTarget(progress: { target: number; unit: "money" | "percent"; currency: string | null }): string {
  if (progress.unit === "percent") return `${progress.target}%`
  return progress.currency ? `${progress.target} ${progress.currency}` : String(progress.target)
}
