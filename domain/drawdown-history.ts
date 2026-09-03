import { MIN_DRAWDOWN_POINTS } from "./risk"

/**
 * Every drawdown a portfolio has had, not just the deepest one.
 *
 * `domain/risk.ts:maxDrawdown` answers "how bad was the worst of it" and this answers "when, how
 * often, and did it come back". They read the same input — the **flow-adjusted return index**, not
 * portfolio value — so a deposit can never look like a recovery and a withdrawal can never look
 * like a fall. That is the single most important property in this file and the reason it takes an
 * index rather than a value series.
 *
 * Derived analytics, never storage: these events are recomputed from the index on every request, so
 * correcting a transaction corrects the history rather than leaving a stored event behind.
 *
 * Pure: no client, no network, no framework import.
 */

export type IndexPoint = { date: string; index: number }

export type DrawdownEvent = {
  peakDate: string
  peakIndex: number
  troughDate: string
  troughIndex: number
  /** Depth as a positive percentage. A 20% fall is 20, never −20. */
  depthPct: number
  /** The date the index first regained its pre-drawdown peak. Null while still below it. */
  recoveryDate: string | null
  /** Observations from peak to trough. */
  declineDays: number
  /** Observations from trough back to the peak. Null while unrecovered. */
  recoveryDays: number | null
  /** True for the drawdown the series is still inside. At most one event has this. */
  ongoing: boolean
}

export type DrawdownHistory = {
  events: DrawdownEvent[]
  /** The deepest, or null when there has never been one. */
  worst: DrawdownEvent | null
  /** How far below the running peak the series ends. 0 at a new high. */
  currentDepthPct: number
  /** The unrecovered drawdown, when the series is in one. */
  ongoing: DrawdownEvent | null
  observations: number
}

/**
 * Falls smaller than this are not reported.
 *
 * A daily series makes dozens of 0.3% dips, and listing them turns a history of what happened into
 * noise that hides it. Named rather than inlined, and documented in
 * `docs/performance-attribution.md` alongside the other thresholds.
 */
export const MIN_REPORTABLE_DEPTH_PCT = 5

/**
 * Every drawdown in a return index.
 *
 * A drawdown begins at a peak, bottoms at a trough and ends when the index regains that peak.
 * Recovery is **the index reaching the old peak**, not merely rising — a rally that stops short is
 * still the same drawdown, and calling it recovered would be the most flattering possible reading
 * of the data.
 *
 * Null below `MIN_DRAWDOWN_POINTS`: a handful of observations has a lowest point, but calling it a
 * drawdown history implies a history that does not exist.
 */
export function drawdownHistory(
  series: readonly IndexPoint[],
  { minDepthPct = MIN_REPORTABLE_DEPTH_PCT }: { minDepthPct?: number } = {},
): DrawdownHistory | null {
  const usable = series
    .filter((p) => Number.isFinite(p.index) && p.index > 0)
    .sort((a, b) => a.date.localeCompare(b.date))

  if (usable.length < MIN_DRAWDOWN_POINTS) return null

  const events: DrawdownEvent[] = []

  let peak = usable[0]
  let peakAt = 0
  let trough: IndexPoint | null = null
  let troughAt = 0

  const close = (recoveryIndex: number | null) => {
    if (!trough) return
    const depthPct = ((peak.index - trough.index) / peak.index) * 100
    if (depthPct >= minDepthPct) {
      events.push({
        peakDate: peak.date,
        peakIndex: peak.index,
        troughDate: trough.date,
        troughIndex: trough.index,
        depthPct,
        recoveryDate: recoveryIndex === null ? null : usable[recoveryIndex].date,
        declineDays: troughAt - peakAt,
        recoveryDays: recoveryIndex === null ? null : recoveryIndex - troughAt,
        ongoing: recoveryIndex === null,
      })
    }
    trough = null
  }

  for (let i = 1; i < usable.length; i += 1) {
    const point = usable[i]

    if (point.index >= peak.index) {
      // A new high ends whatever drawdown was running, at this point.
      close(i)
      peak = point
      peakAt = i
      continue
    }

    // Below the peak: either the start of a fall or a new low within one.
    if (!trough || point.index < trough.index) {
      trough = point
      troughAt = i
    }
  }

  // The series ended below its peak: the last drawdown is unrecovered, not absent.
  close(null)

  const last = usable[usable.length - 1]
  const runningPeak = usable.reduce((highest, p) => (p.index > highest ? p.index : highest), usable[0].index)

  return {
    events,
    worst: events.length > 0 ? [...events].sort((a, b) => b.depthPct - a.depthPct)[0] : null,
    currentDepthPct: runningPeak > 0 ? Math.max(0, ((runningPeak - last.index) / runningPeak) * 100) : 0,
    ongoing: events.find((event) => event.ongoing) ?? null,
    observations: usable.length,
  }
}

/**
 * A sentence for one drawdown.
 *
 * Descriptive and past tense. Recovery that has not happened is reported as ongoing and never
 * projected — Stockly does not have an opinion about when a portfolio will recover, and the
 * strongest honest statement is that it has not yet.
 */
export function describeDrawdown(event: DrawdownEvent): string {
  const depth = event.depthPct.toFixed(1)
  if (event.recoveryDate === null) {
    return `Fell ${depth}% from ${event.peakDate} to ${event.troughDate}. Not yet recovered.`
  }
  return `Fell ${depth}% from ${event.peakDate} to ${event.troughDate}, recovering by ${event.recoveryDate}.`
}

// ---------------------------------------------------------------- regime

/**
 * A plain description of what the series is doing.
 *
 * Deliberately **not** "bull market" or "bear market". Those are claims about a market regime with
 * a methodology behind them; these are four arithmetic states of one portfolio's own index, and
 * naming them after market conditions would borrow authority the calculation has not earned.
 */
export const REGIMES = ["GROWING", "FLAT", "DRAWDOWN", "RECOVERING"] as const
export type Regime = (typeof REGIMES)[number]

export const REGIME_LABELS: Record<Regime, string> = {
  GROWING: "At or near its high",
  FLAT: "Little changed",
  DRAWDOWN: "Below its high",
  RECOVERING: "Recovering",
}

/** Below this the index is treated as unchanged rather than as a trend. */
export const FLAT_BAND_PCT = 1

export function regimeOf(history: DrawdownHistory | null, recentChangePct: number | null): Regime | null {
  if (!history) return null
  if (history.currentDepthPct < FLAT_BAND_PCT) {
    if (recentChangePct === null) return "GROWING"
    return Math.abs(recentChangePct) < FLAT_BAND_PCT ? "FLAT" : "GROWING"
  }
  // Below the peak: rising is a recovery in progress, falling or flat is still the drawdown.
  if (recentChangePct !== null && recentChangePct > FLAT_BAND_PCT) return "RECOVERING"
  return "DRAWDOWN"
}
