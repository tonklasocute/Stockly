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

    const [bundle, unresolvedImportRows, refresh] = await Promise.all([
      loadIntelligence(portfolioId),
      unresolvedImportRowCount().catch(() => 0),
      lastRun(supabase, "data-refresh").catch(() => null),
    ])

    const { analytics } = bundle

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
      // Reconciliation is run on demand against a file, so there is no stored conflict count to
      // report here. Reported as zero rather than invented — the imports page is where a conflict
      // surfaces, with both sides visible.
      importConflicts: 0,
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
