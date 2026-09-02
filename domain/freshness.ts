/**
 * How old a figure may be before Stockly stops presenting it as current.
 *
 * Written because the answer was in four files with two different values. `domain/alerts.ts` used
 * 15 minutes, `domain/data-quality.ts` used a copied `15` under a comment claiming it "matches the
 * alert engine" — a claim nothing enforced — `domain/insights.ts` used 30, and
 * `features/technical/snapshots.ts` used 90. Three of those are deliberate and one was a duplicate
 * waiting to drift.
 *
 * So: one module, named policies, and the differences stated rather than discovered. **The values
 * are unchanged.** Centralising a constant is not a licence to redefine when a price is stale, and
 * the thresholds below decide what a page *says*, never what it *calculates*.
 */

export const FRESHNESS_STATES = ["FRESH", "STALE", "UNAVAILABLE"] as const
export type Freshness = (typeof FRESHNESS_STATES)[number]

/**
 * Why these differ, since a single number would be simpler and wrong:
 *
 * - `quote` (15 min) is what the **alert engine** will act on and what the data-quality page calls
 *   delayed. It is the strictest because it is the one attached to money: an alert firing on a
 *   fifteen-minute-old price is a notification about something that may no longer be true.
 * - `quoteNotice` (30 min) is when an **insight** volunteers that the prices are old. An insight is
 *   a sentence somebody reads, so it is deliberately quieter than the badge beside the figure —
 *   otherwise every page during a slow provider hour grows a paragraph about it.
 * - `fx` (60 min) matches the ten-minute FX cache with a wide margin. Rates move slowly and a pair
 *   is fetched per currency, not per holding, so an hour-old rate is worth naming and no sooner.
 * - `snapshot` (90 min) is a **technical indicator**, computed from daily closes. Its inputs change
 *   once a day; the threshold exists so a screener never presents a cached RSI beside a live price
 *   without saying which is which.
 */
export const FRESHNESS_POLICY = {
  quote: { minutes: 15, label: "market price" },
  quoteNotice: { minutes: 30, label: "market price" },
  fx: { minutes: 60, label: "exchange rate" },
  snapshot: { minutes: 90, label: "technical snapshot" },
} as const

export type FreshnessPolicy = keyof typeof FRESHNESS_POLICY

/** Minutes allowed by a policy, for the modules that only need the number. */
export function staleAfterMinutes(policy: FreshnessPolicy): number {
  return FRESHNESS_POLICY[policy].minutes
}

/**
 * The state of a reading of a given age.
 *
 * A null age is `UNAVAILABLE`, never `STALE` — "we have no price" and "we have an old price" are
 * different facts, and collapsing them is the same mistake as rendering a missing figure as 0.
 */
export function freshnessOf(ageMinutes: number | null, policy: FreshnessPolicy): Freshness {
  if (ageMinutes === null || !Number.isFinite(ageMinutes)) return "UNAVAILABLE"
  return ageMinutes >= FRESHNESS_POLICY[policy].minutes ? "STALE" : "FRESH"
}

/** A sentence for the UI. Never "current" for anything that is not. */
export function describeFreshness(ageMinutes: number | null, policy: FreshnessPolicy): string {
  const { label } = FRESHNESS_POLICY[policy]
  switch (freshnessOf(ageMinutes, policy)) {
    case "UNAVAILABLE":
      return `No ${label} available`
    case "STALE":
      return `Delayed ${label}, ${Math.round(ageMinutes ?? 0)} minutes old`
    case "FRESH":
      return `${label.charAt(0).toUpperCase()}${label.slice(1)} up to date`
  }
}
