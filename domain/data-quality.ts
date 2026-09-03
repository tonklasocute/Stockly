import { staleAfterMinutes } from "./freshness"
import type { Currency, MarketId } from "./market"

/**
 * Data quality: what Stockly knows it does not know.
 *
 * Every other part of the application resolves a missing figure to `null` and renders "N/A". That
 * is correct at the point of use and invisible in aggregate — a user seeing one N/A cannot tell
 * whether it is a one-off or a symptom. This module counts them in one place.
 *
 * Two rules:
 *
 * 1. **No score.** A single "data quality: 78%" would be a number nobody could reproduce or argue
 *    with, assembled from incommensurable things. Transparent counts, each pointing at the resource
 *    it concerns, are what a user can act on.
 * 2. **Every issue is derived, never stored.** There is no `data_quality_issues` table: a scan is a
 *    pure function of the portfolio's current state, so an issue cannot linger after the thing that
 *    caused it was fixed. A stored issue list is a cache that goes wrong quietly.
 *
 * Pure: no database, no network, no clock beyond what is passed in.
 */

export const DATA_QUALITY_CATEGORIES = [
  "MISSING_PRICE",
  "STALE_PRICE",
  "MISSING_FX",
  "STALE_FX",
  "MISSING_METADATA",
  "IMPORT_UNRESOLVED",
  "IMPORT_CONFLICT",
  "CALENDAR_UNVERIFIED",
  "RECONCILIATION_UNRESOLVED",
  "RECONCILIATION_STALE",
  "RECONCILIATION_NEVER_RUN",
] as const
export type DataQualityCategory = (typeof DATA_QUALITY_CATEGORIES)[number]

export const DATA_QUALITY_SEVERITIES = ["INFO", "NOTICE", "WARNING", "ERROR"] as const
export type DataQualitySeverity = (typeof DATA_QUALITY_SEVERITIES)[number]

/*
 * The words for this enum live in the `enums` namespace, keyed by the same values, in every
 * language Stockly ships. A `Record<Enum, string>` of English here would be the copy the other
 * languages drift away from, and this module is the one that must hold no prose at all.
 */

export type DataQualityIssue = {
  category: DataQualityCategory
  severity: DataQualitySeverity
  /** What is affected, in the user's terms. */
  title: string
  detail: string
  /** How many things this covers. Always a real count, never an estimate. */
  count: number
  /** Where to go to do something about it. */
  href: string | null
  /** When the state behind this was observed. */
  observedAt: string
}

/**
 * Thresholds, in one place and documented — the same discipline as `INSIGHT_THRESHOLDS`.
 *
 * These decide whether something is *worth listing*, never whether it is good or bad.
 */
export const DATA_QUALITY_THRESHOLDS = {
  /**
   * Read from `FRESHNESS_POLICY` rather than restated. These used to be the literals `15` and `60`
   * beside a comment claiming they matched the alert engine — a claim nothing enforced, and the
   * exact shape a threshold drifts out of agreement in.
   */
  stalePriceMinutes: staleAfterMinutes("quote"),
  staleFxMinutes: staleAfterMinutes("fx"),
  /**
   * How long a reconciliation stays current.
   *
   * A quarter, because that is the rhythm a statement arrives on. Deliberately not a market
   * freshness policy: `domain/freshness.ts` answers "how old may a *reading* be", and this is not a
   * reading — it is how long ago somebody last checked their own records against a third party.
   */
  staleReconciliationDays: 92,
} as const

/**
 * Everything a scan reads. Supplied by the caller from the loaders that already computed it, so a
 * scan costs no extra query and cannot disagree with the pages it summarises.
 */
export type DataQualityInput = {
  baseCurrency: Currency
  /** Holdings priced from cost because no quote was available. */
  holdingsWithoutPrice: Array<{ symbol: string; market: MarketId }>
  /** Age of the oldest quote behind the current figures, in minutes. */
  oldestQuoteAgeMinutes: number | null
  /** Currency pairs the FX provider could not answer. */
  missingFxPairs: readonly string[]
  /** Pairs answered with a rate older than the freshness threshold. */
  staleFxPairs: readonly string[]
  /** Held instruments the provider returned no sector, industry or country for. */
  holdingsWithoutMetadata: Array<{ symbol: string; market: MarketId }>
  /** Rows from an applied import that were rejected and never became transactions. */
  unresolvedImportRows: number
  /** Reconciliation findings a user has not looked at. */
  importConflicts: number
  /** Unresolved findings from the portfolio's most recent reconciliation run. */
  unresolvedReconciliationItems: number
  /**
   * Whole days since the last reconciliation finished, or null when there has never been one.
   *
   * Null is not "zero days ago" and the two produce different issues — a portfolio nobody has ever
   * reconciled and one reconciled this morning are opposite states.
   */
  daysSinceReconciliation: number | null
  /** How many transactions the portfolio holds; an empty one is not overdue for anything. */
  transactionCount: number
  /** Markets whose holiday table no longer covers today. */
  unverifiedCalendars: MarketId[]
  observedAt: string
}

const SEVERITY_ORDER: Record<DataQualitySeverity, number> = {
  ERROR: 0,
  WARNING: 1,
  NOTICE: 2,
  INFO: 3,
}

/**
 * Every issue the input supports, most severe first.
 *
 * A category with nothing wrong produces no entry at all — an empty list is the honest way to say
 * "nothing found", and padding it with green ticks would make a real finding harder to see.
 */
export function scanDataQuality(input: DataQualityInput): DataQualityIssue[] {
  const issues: DataQualityIssue[] = []
  const at = input.observedAt

  if (input.missingFxPairs.length > 0) {
    issues.push({
      category: "MISSING_FX",
      severity: "ERROR",
      title: `No exchange rate for ${input.missingFxPairs.join(", ")}`,
      detail:
        `Holdings in those currencies cannot be expressed in ${input.baseCurrency}, so they are ` +
        "excluded from every total rather than converted at a made-up rate.",
      count: input.missingFxPairs.length,
      href: "/settings",
      observedAt: at,
    })
  }

  if (input.holdingsWithoutPrice.length > 0) {
    const names = input.holdingsWithoutPrice.map((h) => h.symbol).slice(0, 5).join(", ")
    issues.push({
      category: "MISSING_PRICE",
      severity: "WARNING",
      title: `${input.holdingsWithoutPrice.length} holding${input.holdingsWithoutPrice.length === 1 ? "" : "s"} valued at cost`,
      detail:
        `No live price was available for ${names}${input.holdingsWithoutPrice.length > 5 ? " and others" : ""}. ` +
        "Market value and unrealised P&L for those positions show a flat return until prices return.",
      count: input.holdingsWithoutPrice.length,
      href: "/portfolio",
      observedAt: at,
    })
  }

  if (input.importConflicts > 0) {
    issues.push({
      category: "IMPORT_CONFLICT",
      severity: "WARNING",
      title: `${input.importConflicts} import conflict${input.importConflicts === 1 ? "" : "s"}`,
      detail:
        "A file disagrees with a stored transaction about a price, quantity or date. Nothing has " +
        "been changed — Stockly never overwrites a transaction to match a file.",
      count: input.importConflicts,
      href: "/imports",
      observedAt: at,
    })
  }

  /*
   * Reconciliation findings nobody has looked at.
   *
   * A WARNING rather than an ERROR, and the wording is careful about why: a difference is not proof
   * that Stockly is wrong. It is proof that two records disagree, and which one is right is
   * something only the user can say.
   */
  if (input.unresolvedReconciliationItems > 0) {
    issues.push({
      category: "RECONCILIATION_UNRESOLVED",
      severity: "WARNING",
      title: `${input.unresolvedReconciliationItems} reconciliation finding${input.unresolvedReconciliationItems === 1 ? "" : "s"} to review`,
      detail:
        "Your last reconciliation found differences between a statement and this portfolio. " +
        "Nothing has been changed — a difference becomes a change only when you approve one.",
      count: input.unresolvedReconciliationItems,
      href: "/operations",
      observedAt: at,
    })
  }

  if (input.daysSinceReconciliation === null && input.transactionCount > 0) {
    issues.push({
      category: "RECONCILIATION_NEVER_RUN",
      severity: "INFO",
      title: "This portfolio has never been reconciled",
      detail:
        "Comparing a broker statement against these records is the only way to find a trade that " +
        "was never entered. It changes nothing on its own.",
      count: 1,
      href: "/operations",
      observedAt: at,
    })
  } else if (
    input.daysSinceReconciliation !== null &&
    input.daysSinceReconciliation > DATA_QUALITY_THRESHOLDS.staleReconciliationDays
  ) {
    issues.push({
      category: "RECONCILIATION_STALE",
      severity: "NOTICE",
      title: `Last reconciled ${input.daysSinceReconciliation} days ago`,
      detail:
        "A missing trade is easiest to find close to when it happened. This is a reminder rather " +
        "than a finding: nothing has been compared.",
      count: 1,
      href: "/operations",
      observedAt: at,
    })
  }

  if (input.unresolvedImportRows > 0) {
    issues.push({
      category: "IMPORT_UNRESOLVED",
      severity: "NOTICE",
      title: `${input.unresolvedImportRows} import row${input.unresolvedImportRows === 1 ? "" : "s"} rejected`,
      detail:
        "Those rows failed validation and never became transactions. Fix them in the file and " +
        "import it again — re-importing what already succeeded creates nothing.",
      count: input.unresolvedImportRows,
      href: "/imports",
      observedAt: at,
    })
  }

  if (input.staleFxPairs.length > 0) {
    issues.push({
      category: "STALE_FX",
      severity: "NOTICE",
      title: `${input.staleFxPairs.join(", ")} rate is over an hour old`,
      detail: "Converted figures are marked delayed wherever they appear.",
      count: input.staleFxPairs.length,
      href: "/settings",
      observedAt: at,
    })
  }

  if (
    input.oldestQuoteAgeMinutes !== null &&
    input.oldestQuoteAgeMinutes >= DATA_QUALITY_THRESHOLDS.stalePriceMinutes
  ) {
    issues.push({
      category: "STALE_PRICE",
      severity: "NOTICE",
      title: `Prices are ${Math.round(input.oldestQuoteAgeMinutes)} minutes old`,
      detail:
        "Quotes are cached for a minute at a time and refreshed on the schedule. A figure this old " +
        "is presented as delayed rather than current.",
      count: 1,
      href: "/settings",
      observedAt: at,
    })
  }

  if (input.holdingsWithoutMetadata.length > 0) {
    issues.push({
      category: "MISSING_METADATA",
      severity: "INFO",
      title: `${input.holdingsWithoutMetadata.length} holding${input.holdingsWithoutMetadata.length === 1 ? " has" : "s have"} no sector data`,
      detail:
        "The provider returned no sector, industry or country for them. They are grouped as " +
        "Unknown in allocation rather than dropped from it.",
      count: input.holdingsWithoutMetadata.length,
      href: "/analytics",
      observedAt: at,
    })
  }

  if (input.unverifiedCalendars.length > 0) {
    issues.push({
      category: "CALENDAR_UNVERIFIED",
      severity: "INFO",
      title: `Trading calendar unverified for ${input.unverifiedCalendars.join(", ")}`,
      detail:
        "Today is past the last date the holiday table was checked against the exchange's own " +
        "calendar, so market status answers \"unknown\" rather than guessing. Refresh the table in " +
        "domain/market.ts.",
      count: input.unverifiedCalendars.length,
      href: "/settings",
      observedAt: at,
    })
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/** Counts by severity, for a badge. Absent severities are omitted rather than shown as zero. */
export function summariseIssues(
  issues: readonly DataQualityIssue[],
): Partial<Record<DataQualitySeverity, number>> {
  const out: Partial<Record<DataQualitySeverity, number>> = {}
  for (const issue of issues) out[issue.severity] = (out[issue.severity] ?? 0) + 1
  return out
}

/** The worst severity present, or null when nothing was found. */
export function worstSeverity(
  issues: readonly DataQualityIssue[],
): DataQualitySeverity | null {
  if (issues.length === 0) return null
  return issues.reduce<DataQualitySeverity>(
    (worst, issue) => (SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[worst] ? issue.severity : worst),
    "INFO",
  )
}
