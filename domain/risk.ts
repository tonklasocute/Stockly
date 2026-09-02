/**
 * Portfolio risk metrics.
 *
 * Two rules govern every function here, and between them they decide most of the design:
 *
 * 1. **Risk is measured on flow-adjusted returns, never on raw portfolio value.** A deposit raises
 *    the value without being a recovery; a withdrawal lowers it without being a loss. A drawdown
 *    computed from value would report the day someone paid in as a rally, and the day they took
 *    money out as a crash. Everything here consumes the TWR index from `domain/returns.ts`.
 *
 * 2. **A statistic computed from too few observations is not a weak statistic — it is a made-up
 *    one.** Every function has a stated minimum and returns `null` below it. Twelve daily
 *    observations do not produce an annualised volatility; they produce a number with the shape of
 *    one. `null` renders "N/A", which is the truth.
 *
 * Stockly's valuations come from `portfolio_snapshots`, which are written when a user opens the
 * app — so the series is irregular and often sparse. That is exactly why the minimums matter, and
 * why every result carries the observation count that produced it.
 *
 * Pure: no clock, no database, no framework.
 */
import { percentOf, quantize, roundTo, sumBy } from "./money"

/**
 * The smallest sample that produces a defensible standard deviation.
 *
 * Thirty is the conventional floor for treating a sample statistic as usable, and with Stockly's
 * visit-driven snapshots it is roughly a month and a half of active use. Below it, volatility and
 * everything derived from it report `null`.
 */
export const MIN_RETURN_OBSERVATIONS = 30

/** Beta needs paired observations, and pairs are scarcer than singles. Same reasoning, same floor. */
export const MIN_PAIRED_OBSERVATIONS = 30

/** A drawdown needs enough of a series to have had a peak and a trough. */
export const MIN_DRAWDOWN_POINTS = 5

/**
 * Trading days in a year, for annualising a daily series.
 *
 * 252 is the convention for daily equity returns. Stockly's observations are *not* strictly daily —
 * a snapshot exists for each day the user opened the app — so annualising them at 252 assumes the
 * observed days are representative of trading days. That assumption is stated on screen beside the
 * figure rather than buried here, because it is the main reason a Stockly volatility differs from a
 * broker's.
 */
export const TRADING_DAYS_PER_YEAR = 252

/**
 * The risk-free rate Sharpe is measured against, as a decimal fraction per year.
 *
 * Zero, deliberately and disclosed. Stockly has no risk-free curve and no defensible way to pick a
 * rate that is right for a user whose base currency it does not know in this module — so rather
 * than invent one, the assumption is "excess return over 0%", which makes Sharpe exactly
 * return ÷ volatility. The UI states the assumption next to the number. A caller with a real rate
 * passes it in; nothing here hardcodes a value into a result.
 */
export const DEFAULT_RISK_FREE_RATE = 0

// ---------------------------------------------------------------- dispersion

/** Sample standard deviation (n − 1). Null below `minObservations`. */
export function standardDeviation(
  values: readonly number[],
  minObservations = MIN_RETURN_OBSERVATIONS,
): number | null {
  const usable = values.filter((v) => Number.isFinite(v))
  if (usable.length < Math.max(2, minObservations)) return null

  const mean = sumBy(usable, (v) => v, 1e9) / usable.length
  // n − 1: these are a sample of the portfolio's behaviour, not its entire population.
  const variance = sumBy(usable, (v) => (v - mean) ** 2, 1e9) / (usable.length - 1)
  return Number.isFinite(variance) ? Math.sqrt(variance) : null
}

export type Volatility = {
  /** Annualised standard deviation of returns, as a percentage. */
  annualisedPct: number
  /** Standard deviation of the observed periods themselves, as a percentage. */
  periodPct: number
  observations: number
  periodsPerYear: number
}

/**
 * Annualised volatility of a return series.
 *
 * Method, stated because it is the only way the number means anything:
 *   • observations — one per valuation point, flow-adjusted (see the module comment)
 *   • return       — simple period return, not log
 *   • annualisation — σ_period × √(periods per year)
 *
 * Null below `MIN_RETURN_OBSERVATIONS`. A portfolio three weeks old has no volatility; it has three
 * weeks of history.
 */
export function volatility(
  returns: readonly number[],
  {
    periodsPerYear = TRADING_DAYS_PER_YEAR,
    minObservations = MIN_RETURN_OBSERVATIONS,
  }: { periodsPerYear?: number; minObservations?: number } = {},
): Volatility | null {
  const sigma = standardDeviation(returns, minObservations)
  if (sigma === null || periodsPerYear <= 0) return null

  return {
    annualisedPct: quantize(sigma * Math.sqrt(periodsPerYear) * 100),
    periodPct: quantize(sigma * 100),
    observations: returns.filter((v) => Number.isFinite(v)).length,
    periodsPerYear,
  }
}

export type Sharpe = {
  ratio: number
  /** The assumption the number depends on, carried with it so the UI can state it. */
  riskFreeRatePct: number
  observations: number
  periodsPerYear: number
}

/**
 * Sharpe ratio: annualised excess return divided by annualised volatility.
 *
 *     Sharpe = (annualised return − risk-free) / annualised volatility
 *
 * Null when volatility is null (too few observations) **or zero** — a portfolio that has not moved
 * has an undefined Sharpe, not an infinite one, and dividing by zero here would put `Infinity` on a
 * dashboard.
 *
 * The risk-free rate is an input with a disclosed default of 0; see `DEFAULT_RISK_FREE_RATE`.
 */
export function sharpeRatio(
  returns: readonly number[],
  {
    riskFreeRate = DEFAULT_RISK_FREE_RATE,
    periodsPerYear = TRADING_DAYS_PER_YEAR,
    minObservations = MIN_RETURN_OBSERVATIONS,
  }: { riskFreeRate?: number; periodsPerYear?: number; minObservations?: number } = {},
): Sharpe | null {
  const usable = returns.filter((v) => Number.isFinite(v))
  const vol = volatility(usable, { periodsPerYear, minObservations })
  if (!vol || vol.annualisedPct === 0) return null

  const meanPeriodReturn = sumBy(usable, (v) => v, 1e9) / usable.length
  const annualisedReturn = (1 + meanPeriodReturn) ** periodsPerYear - 1
  if (!Number.isFinite(annualisedReturn)) return null

  return {
    ratio: roundTo((annualisedReturn - riskFreeRate) / (vol.annualisedPct / 100), 2),
    riskFreeRatePct: quantize(riskFreeRate * 100),
    observations: usable.length,
    periodsPerYear,
  }
}

// ---------------------------------------------------------------- drawdown

export type Drawdown = {
  /** Deepest peak-to-trough fall in the series, as a positive percentage. */
  maxDrawdownPct: number
  /** How far below the running peak the series ends. 0 when it ends at a new high. */
  currentDrawdownPct: number
  peakDate: string
  troughDate: string
  /** The date the series first regained its pre-drawdown peak. Null while still below it. */
  recoveredOn: string | null
  /** Days from peak to trough. */
  declineDays: number
  observations: number
}

/**
 * Maximum drawdown of a return index.
 *
 * **Not computed from the current value alone**, and not from portfolio value at all: the input is
 * the flow-adjusted TWR index, so a deposit cannot disguise a fall and a withdrawal cannot invent
 * one. `returnIndex` in `domain/returns.ts` produces it.
 *
 * Null below `MIN_DRAWDOWN_POINTS` — a handful of valuations has a lowest point, but calling it a
 * maximum drawdown implies a history that does not exist.
 */
export function maxDrawdown(
  series: readonly { date: string; index: number }[],
  { minPoints = MIN_DRAWDOWN_POINTS }: { minPoints?: number } = {},
): Drawdown | null {
  const usable = series.filter((p) => Number.isFinite(p.index) && p.index > 0)
  if (usable.length < minPoints) return null

  let peak = usable[0]
  let worst = { peak: usable[0], trough: usable[0], depth: 0 }

  for (const point of usable) {
    if (point.index > peak.index) peak = point
    const depth = (peak.index - point.index) / peak.index
    if (depth > worst.depth) worst = { peak, trough: point, depth }
  }

  // Recovery is measured against the peak the worst drawdown started from, not the running peak.
  const recovered =
    usable.find((p) => p.date > worst.trough.date && p.index >= worst.peak.index)?.date ?? null

  const last = usable[usable.length - 1]
  const runningPeak = usable.reduce((max, p) => (p.index > max ? p.index : max), usable[0].index)

  return {
    maxDrawdownPct: quantize(worst.depth * 100),
    currentDrawdownPct: quantize(Math.max(0, (runningPeak - last.index) / runningPeak) * 100),
    peakDate: worst.peak.date,
    troughDate: worst.trough.date,
    recoveredOn: recovered,
    declineDays: Math.max(
      0,
      Math.round((Date.parse(worst.trough.date) - Date.parse(worst.peak.date)) / 86_400_000),
    ),
    observations: usable.length,
  }
}

// ---------------------------------------------------------------- beta

export type Beta = {
  beta: number
  /** How much of the portfolio's movement the benchmark explains, 0–1. */
  rSquared: number | null
  observations: number
}

/**
 * Beta of a portfolio against a benchmark: cov(p, b) / var(b).
 *
 * The two series must be **paired** — the same dates, in the same order — which is the caller's job
 * and the reason this takes two arrays rather than two date-keyed maps: aligning them is a
 * data-loading concern with its own honest failure mode (a benchmark with no history for a date
 * drops that date from both sides, rather than being filled in).
 *
 * Null when the arrays differ in length, are shorter than `MIN_PAIRED_OBSERVATIONS`, or the
 * benchmark did not move at all — a beta against a flat series is a division by zero, not infinity.
 */
export function beta(
  portfolioReturns: readonly number[],
  benchmarkReturns: readonly number[],
  { minObservations = MIN_PAIRED_OBSERVATIONS }: { minObservations?: number } = {},
): Beta | null {
  if (portfolioReturns.length !== benchmarkReturns.length) return null
  const n = portfolioReturns.length
  if (n < Math.max(2, minObservations)) return null
  if (!portfolioReturns.every(Number.isFinite) || !benchmarkReturns.every(Number.isFinite)) return null

  const meanP = sumBy(portfolioReturns, (v) => v, 1e9) / n
  const meanB = sumBy(benchmarkReturns, (v) => v, 1e9) / n

  let covariance = 0
  let varianceB = 0
  let varianceP = 0
  for (let i = 0; i < n; i += 1) {
    const dp = portfolioReturns[i] - meanP
    const db = benchmarkReturns[i] - meanB
    covariance += dp * db
    varianceB += db * db
    varianceP += dp * dp
  }
  if (!(varianceB > 0)) return null

  const value = covariance / varianceB
  if (!Number.isFinite(value)) return null

  const correlation = varianceP > 0 ? covariance / Math.sqrt(varianceP * varianceB) : null

  return {
    beta: roundTo(value, 2),
    rSquared: correlation === null ? null : roundTo(correlation ** 2, 2),
    observations: n,
  }
}

// ---------------------------------------------------------------- concentration

export type ConcentrationDetail = {
  /** Herfindahl–Hirschman index over position weights, 0–10000. */
  hhi: number
  /** The equivalent number of equally-sized positions — 10000/HHI. Easier to read than HHI itself. */
  effectivePositions: number
  largestWeightPct: number
  top3WeightPct: number
  top5WeightPct: number
  positions: number
}

/**
 * Concentration over position weights, as percentages summing to ~100.
 *
 * HHI is reported rather than a bespoke "risk score": it is a standard, checkable measure with a
 * published meaning, whereas a score invented here would be a number nobody could argue with
 * because nobody could reproduce it. `effectivePositions` is the same information stated in a way a
 * user can act on — "this behaves like 3.2 equally-sized positions".
 *
 * Null for an empty portfolio: no positions is not a concentration of zero.
 */
export function concentrationDetail(
  weightsPct: readonly number[],
): ConcentrationDetail | null {
  const usable = weightsPct.filter((w) => Number.isFinite(w) && w > 0)
  if (usable.length === 0) return null

  const sorted = [...usable].sort((a, b) => b - a)
  const hhi = sumBy(sorted, (w) => w * w, 1e6)
  const topN = (n: number) => roundTo(sumBy(sorted.slice(0, n), (w) => w), 2)

  return {
    hhi: roundTo(hhi, 0),
    effectivePositions: hhi > 0 ? roundTo(10_000 / hhi, 1) : 0,
    largestWeightPct: roundTo(sorted[0], 2),
    top3WeightPct: topN(3),
    top5WeightPct: topN(5),
    positions: sorted.length,
  }
}

/** A share of a total, or null when the total is zero — never a fabricated 0%. */
export function shareOf(part: number, total: number): number | null {
  return percentOf(part, total)
}
