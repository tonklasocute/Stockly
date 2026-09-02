/**
 * Return measurement: separating what the investments did from what the investor did.
 *
 * The distinction this module exists to enforce, and the reason a portfolio total is not a return:
 *
 *   A deposit raises the value of a portfolio without earning a cent.
 *   A withdrawal lowers it without losing one.
 *
 * So every figure here subtracts external capital flows on both sides. `(end − start) / start` is
 * the number that makes a portfolio look like it doubled when the user simply paid in again, and it
 * appears nowhere in this file.
 *
 * Two measures, answering two different questions:
 *
 *   **Time-weighted (TWR)** — how did the *investments* perform, independent of when money was
 *   added? This is what a benchmark can be compared against, because an index has no deposits.
 *   **Money-weighted (IRR / MWR)** — what did *this investor* actually earn, given when they put
 *   money in? Timing counts here, which is why it cannot be compared to an index.
 *
 * Pure: no clock, no database, no framework. Every input is passed in.
 */
import { percentOf, quantize, sumBy } from "./money"

/**
 * A portfolio valuation on one date, with the external money that moved into or out of it since the
 * previous point.
 *
 * `flow` is **net external capital**: deposits minus withdrawals. A buy is not a flow — it moves
 * money inside the portfolio, from cash into a holding, and changes nothing about how much capital
 * the investor committed.
 */
export type ValuationPoint = {
  date: string
  /** Total portfolio value on that date: holdings plus cash. */
  value: number
  /** Net external capital that arrived since the previous point. Positive in, negative out. */
  flow: number
}

/** One sub-period's return, with the two values it was computed from. */
export type SubPeriodReturn = {
  from: string
  to: string
  /** Fractional, not percent: 0.0234 is +2.34%. */
  ratio: number
}

/**
 * The smallest number of valuation points that can produce a return at all: a start and an end.
 * Statistics computed *over* these returns need far more — see `MIN_RETURN_OBSERVATIONS` in risk.ts.
 */
export const MIN_VALUATION_POINTS = 2

/**
 * Sub-period returns, each with the flow into that period removed.
 *
 *     r = (V_end − F) / V_start − 1
 *
 * **The flow is treated as arriving at the end of the sub-period.** With daily valuations that is
 * accurate to within one day's market movement on the deposited amount. It is stated rather than
 * hidden because Stockly's snapshots are written when a user opens the app, so a gap of several
 * days is normal and the approximation is correspondingly looser over one.
 *
 * A sub-period starting from a non-positive value has no defined return — you cannot divide by a
 * portfolio that was worth nothing — and the whole series returns `null` rather than silently
 * skipping it, because a chain of returns with a hole in it is not the return of the chain.
 */
export function subPeriodReturns(points: readonly ValuationPoint[]): SubPeriodReturn[] | null {
  if (points.length < MIN_VALUATION_POINTS) return null

  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const out: SubPeriodReturn[] = []

  for (let i = 1; i < ordered.length; i += 1) {
    const start = ordered[i - 1]
    const end = ordered[i]
    if (!(start.value > 0)) return null
    if (!Number.isFinite(end.value) || !Number.isFinite(end.flow)) return null
    out.push({ from: start.date, to: end.date, ratio: (end.value - end.flow) / start.value - 1 })
  }

  return out
}

/**
 * Time-weighted return over the whole series, as a **percentage**.
 *
 *     TWR = Π(1 + rᵢ) − 1
 *
 * Chaining the sub-periods is what makes the timing of deposits irrelevant: each period is weighted
 * by its length, not by how much money happened to be in the account during it. That is precisely
 * the property a benchmark comparison needs.
 *
 * Null when there are fewer than two valuations, or when any sub-period is undefined.
 */
export function timeWeightedReturn(points: readonly ValuationPoint[]): number | null {
  const returns = subPeriodReturns(points)
  if (!returns || returns.length === 0) return null

  const growth = returns.reduce((acc, r) => acc * (1 + r.ratio), 1)
  if (!Number.isFinite(growth)) return null
  return quantize((growth - 1) * 100)
}

/**
 * The growth of one unit of money through the series — the TWR index.
 *
 * This is the series drawdown and volatility are computed from, **not** raw portfolio value. A
 * deposit raises value without being a recovery, and a withdrawal lowers it without being a loss;
 * measuring risk on raw values would report both as market movement.
 */
export function returnIndex(points: readonly ValuationPoint[]): Array<{ date: string; index: number }> | null {
  const returns = subPeriodReturns(points)
  if (!returns) return null

  const ordered = [...points].sort((a, b) => a.date.localeCompare(b.date))
  const series = [{ date: ordered[0].date, index: 1 }]
  let level = 1
  for (const r of returns) {
    level *= 1 + r.ratio
    if (!Number.isFinite(level)) return null
    series.push({ date: r.to, index: level })
  }
  return series
}

// ---------------------------------------------------------------- money-weighted

/** One dated external cash flow. Sign convention: money **into** the portfolio is negative. */
export type DatedFlow = { date: string; amount: number }

/** Below this the answer is arithmetic noise rather than a rate of return. */
export const MIN_IRR_DAYS = 30

const DAY_MS = 86_400_000

/**
 * Day count: actual days over 365.25.
 *
 * Stated because it is visible in the output — a calendar year is 365 days, so a position that
 * exactly doubles over one solves to 100.09% rather than 100%. The alternative conventions
 * (ACT/365, 30/360) each distort a different case; 365.25 averages the leap year and is the
 * convention IRR is normally quoted under.
 */
function yearsBetween(from: string, to: string): number {
  return (Date.parse(to) - Date.parse(from)) / (DAY_MS * 365.25)
}

function netPresentValue(flows: readonly DatedFlow[], rate: number, origin: string): number {
  return sumBy(flows, (flow) => flow.amount / (1 + rate) ** yearsBetween(origin, flow.date), 1e9)
}

/**
 * Money-weighted return (annualised IRR), as a **percentage**.
 *
 * Solved by bisection rather than Newton–Raphson: a cash-flow series can have a derivative near
 * zero, and a Newton step that overshoots into a rate below −100% produces a complex result and a
 * `NaN` that would propagate into a portfolio figure. Bisection cannot overshoot, converges on
 * every sign-changing interval, and 200 iterations over ±[−99.9%, 10000%] is microseconds.
 *
 * Null — never 0 — when: there are fewer than two flows, they do not change sign (no rate solves a
 * series that only ever went one way), the period is shorter than `MIN_IRR_DAYS`, or no root exists
 * in the bracket. An IRR that did not converge is not an IRR of zero.
 */
export function moneyWeightedReturn(
  flows: readonly DatedFlow[],
  { minDays = MIN_IRR_DAYS }: { minDays?: number } = {},
): number | null {
  const ordered = [...flows]
    .filter((f) => Number.isFinite(f.amount) && !Number.isNaN(Date.parse(f.date)))
    .sort((a, b) => a.date.localeCompare(b.date))

  if (ordered.length < 2) return null
  const hasIn = ordered.some((f) => f.amount < 0)
  const hasOut = ordered.some((f) => f.amount > 0)
  // Without both signs there is nothing to solve: money that only ever went in has no return yet.
  if (!hasIn || !hasOut) return null

  const origin = ordered[0].date
  const spanDays = (Date.parse(ordered[ordered.length - 1].date) - Date.parse(origin)) / DAY_MS
  if (spanDays < minDays) return null

  let low = -0.999
  let high = 100
  let npvLow = netPresentValue(ordered, low, origin)
  let npvHigh = netPresentValue(ordered, high, origin)
  if (!Number.isFinite(npvLow) || !Number.isFinite(npvHigh)) return null
  // No sign change means no root inside the bracket; widening it further is not meaningful.
  if (npvLow * npvHigh > 0) return null

  for (let i = 0; i < 200; i += 1) {
    const mid = (low + high) / 2
    const npvMid = netPresentValue(ordered, mid, origin)
    if (!Number.isFinite(npvMid)) return null
    if (Math.abs(npvMid) < 1e-9 || high - low < 1e-12) return quantize(mid * 100)
    if (npvLow * npvMid <= 0) {
      high = mid
      npvHigh = npvMid
    } else {
      low = mid
      npvLow = npvMid
    }
  }
  return quantize(((low + high) / 2) * 100)
}

// ---------------------------------------------------------------- simple helpers

/**
 * The plain start-to-end change of a series, as a percentage — **valid only when no capital moved**.
 * Used for a benchmark index, which by definition has no deposits, and never for a portfolio.
 */
export function simpleReturn(start: number, end: number): number | null {
  if (!(start > 0) || !Number.isFinite(end)) return null
  return percentOf(end - start, start)
}
