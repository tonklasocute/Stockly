import "server-only"

import { cache } from "react"
import { calendarCovers, marketDate } from "@/domain/calendar"
import { MARKETS, type MarketId } from "@/domain/market"
import {
  DATA_QUALITY_THRESHOLDS,
  scanDataQuality,
  summariseIssues,
  worstSeverity,
  type DataQualityIssue,
  type DataQualitySeverity,
} from "@/domain/data-quality"
import { loadIntelligence } from "@/features/intelligence/loader"
import { unresolvedImportRowCount } from "@/features/imports/queries"
import { lastRun } from "@/features/automation/refresh"
import { listRuns, unresolvedCount } from "@/features/operations/queries"
import { createClient } from "@/lib/supabase/server"
import type { JobExecutionRow } from "@/types/database"

/**
 * A data-quality scan.
 *
 * Everything it reads is already loaded: `loadIntelligence` is the cached pass the dashboard and
 * the review page share, so a scan costs one import-row count and one job-history read on top of a
 * page the user was going to load anyway. Nothing is stored — an issue is a pure function of the
 * current state, so it cannot linger after the thing that caused it was fixed.
 */

export type DataQualityReport = {
  issues: DataQualityIssue[]
  bySeverity: Partial<Record<DataQualitySeverity, number>>
  worst: DataQualitySeverity | null
  /** When the scheduled refresh last ran, so the page can say how current any of this is. */
  lastRefresh: JobExecutionRow | null
  observedAt: string
}

export const loadDataQuality = cache(
  async (portfolioId: string): Promise<DataQualityReport> => {
    const supabase = await createClient()
    const now = new Date()
    const observedAt = now.toISOString()

    const [bundle, unresolvedImportRows, refresh, runs, unresolvedFindings] = await Promise.all([
      loadIntelligence(portfolioId),
      unresolvedImportRowCount().catch(() => 0),
      lastRun(supabase, "data-refresh").catch(() => null),
      // Both degrade to "never reconciled" rather than taking the page down: a data-quality page
      // that cannot render because one of its inputs failed is the least useful failure available.
      listRuns(portfolioId, 1).catch(() => []),
      unresolvedCount(portfolioId).catch(() => 0),
    ])

    const { analytics } = bundle
    const lastCompleted = runs.find(
      (run) => run.status === "COMPLETED" || run.status === "COMPLETED_WITH_WARNINGS",
    )

    const unverifiedCalendars: MarketId[] = MARKETS.filter(
      (market) => !calendarCovers(market, marketDate(market, now)),
    )

    const issues = scanDataQuality({
      baseCurrency: bundle.baseCurrency,
      holdingsWithoutPrice: analytics.holdings
        .filter((holding) => holding.stale)
        .map((holding) => ({ symbol: holding.symbol, market: holding.market })),
      oldestQuoteAgeMinutes: analytics.quoteAgeMinutes,
      missingFxPairs: analytics.missingFxPairs,
      // A rate Stockly has but which is over an hour old. `fxStaleCount` counts holdings; this
      // names the pairs, which is what a user can act on.
      staleFxPairs: analytics.summary.exposures
        .filter((exposure) => exposure.fx?.freshness === "stale")
        .map((exposure) => `${exposure.currency}/${bundle.baseCurrency}`),
      holdingsWithoutMetadata: analytics.holdingsWithoutMetadata,
      unresolvedImportRows,
      // An import conflict is found on demand against a file and never stored, so there is no
      // count to report here. Zero rather than invented — the imports page is where one surfaces,
      // with both sides visible.
      importConflicts: 0,
      unresolvedReconciliationItems: unresolvedFindings,
      /*
       * Null when there has never been a completed run, and it must stay null: "never reconciled"
       * and "reconciled today" are opposite states, and a zero would report the second.
       *
       * A run still in PROGRESS or one that FAILED does not count as a reconciliation having
       * happened — which is exactly what makes a stuck run visible here.
       */
      daysSinceReconciliation: daysSince(lastCompleted?.completed_at ?? null, now),
      transactionCount: analytics.transactionCount,
      unverifiedCalendars,
      observedAt,
    })

    return {
      issues,
      bySeverity: summariseIssues(issues),
      worst: worstSeverity(issues),
      lastRefresh: refresh,
      observedAt,
    }
  },
)

export { DATA_QUALITY_THRESHOLDS }

/** Whole days between an ISO timestamp and now, or null when there is no timestamp at all. */
function daysSince(at: string | null, now: Date): number | null {
  if (!at) return null
  const then = Date.parse(at)
  if (Number.isNaN(then)) return null
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000))
}
