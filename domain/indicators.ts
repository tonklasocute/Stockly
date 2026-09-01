import { quantize } from "./money"

/**
 * Technical indicators.
 *
 * Pure functions over an OHLCV series. No provider, no React, no clock. Every one returns an array
 * the **same length as its input**, with `null` for the leading periods where the indicator is not
 * yet defined. That alignment is not cosmetic: crossing detection compares index `i` against `i-1`
 * across two different indicators, and silently dropping warm-up values would shift them apart.
 *
 * `null` means "not computable here", never 0. An RSI of 0 is a real, extreme reading; an RSI that
 * does not exist yet is a different statement.
 */

export type Candle = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/** Same length as the input series; `null` until the indicator has enough history. */
export type Series = Array<number | null>

// ---------------------------------------------------------------- data quality

export type SeriesIssue =
  | "duplicate-timestamp"
  | "out-of-order"
  | "invalid-ohlc"
  | "non-positive-price"
  | "zero-volume"

export type CleanResult = { candles: Candle[]; issues: SeriesIssue[]; dropped: number }

/**
 * Providers return imperfect series: a repeated timestamp after a retry, a placeholder bar where a
 * holiday should be, an occasional low above its high. Feeding those straight into an EMA produces
 * a number that looks authoritative and is wrong, so the series is cleaned first and the problems
 * are reported rather than swallowed.
 */
export function cleanSeries(candles: readonly Candle[]): CleanResult {
  const issues = new Set<SeriesIssue>()
  const seen = new Set<string>()
  const out: Candle[] = []
  let previousDate: string | null = null
  let dropped = 0

  for (const candle of candles) {
    if (seen.has(candle.date)) {
      issues.add("duplicate-timestamp")
      dropped += 1
      continue
    }
    if (previousDate !== null && candle.date < previousDate) issues.add("out-of-order")

    const prices = [candle.open, candle.high, candle.low, candle.close]
    if (prices.some((p) => !Number.isFinite(p))) {
      issues.add("invalid-ohlc")
      dropped += 1
      continue
    }
    if (prices.some((p) => p <= 0)) {
      // A non-positive price is not a market event; it is bad data.
      issues.add("non-positive-price")
      dropped += 1
      continue
    }
    if (candle.high < candle.low || candle.high < candle.close || candle.low > candle.close) {
      issues.add("invalid-ohlc")
      dropped += 1
      continue
    }
    if (candle.volume === 0) {
      // Kept: a genuinely untraded session is information. Flagged so relative volume can be
      // treated with suspicion.
      issues.add("zero-volume")
    }

    seen.add(candle.date)
    previousDate = candle.date
    out.push(candle)
  }

  // Sorted defensively: an out-of-order series would make every "previous" comparison meaningless.
  out.sort((a, b) => a.date.localeCompare(b.date))
  return { candles: out, issues: [...issues], dropped }
}

// ---------------------------------------------------------------- moving averages

/** Simple moving average: the arithmetic mean of the last `period` values. */
export function sma(values: readonly number[], period: number): Series {
  if (period <= 0) return values.map(() => null)
  const out: Series = new Array(values.length).fill(null)
  let sum = 0

  for (let i = 0; i < values.length; i += 1) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = quantize(sum / period)
  }
  return out
}

/**
 * Exponential moving average, seeded with the simple average of the first `period` values.
 *
 * The seed matters: starting from the first close instead makes the early values depend heavily on
 * one arbitrary bar, and two implementations that disagree on the seed disagree for hundreds of
 * bars afterwards. Wilder's convention (SMA seed) is what charting packages use.
 */
export function ema(values: readonly number[], period: number): Series {
  if (period <= 0 || values.length < period) return values.map(() => null)

  const out: Series = new Array(values.length).fill(null)
  const k = 2 / (period + 1)

  let seed = 0
  for (let i = 0; i < period; i += 1) seed += values[i]
  let previous = seed / period
  out[period - 1] = quantize(previous)

  for (let i = period; i < values.length; i += 1) {
    previous = values[i] * k + previous * (1 - k)
    out[i] = quantize(previous)
  }
  return out
}

/** Wilder's smoothing: the α = 1/period variant used by RSI, ATR and ADX. */
function wilderSmooth(values: readonly number[], period: number): Series {
  if (period <= 0 || values.length < period) return values.map(() => null)

  const out: Series = new Array(values.length).fill(null)
  let sum = 0
  for (let i = 0; i < period; i += 1) sum += values[i]
  let previous = sum / period
  out[period - 1] = previous

  for (let i = period; i < values.length; i += 1) {
    previous = (previous * (period - 1) + values[i]) / period
    out[i] = previous
  }
  return out
}

// ---------------------------------------------------------------- RSI

/**
 * Relative strength index, Wilder's original formulation.
 *
 *   RS  = average gain / average loss   (both Wilder-smoothed over `period`)
 *   RSI = 100 − 100 / (1 + RS)
 *
 * A period with no losses at all gives RSI 100 by definition — division by zero is the correct
 * answer here, not an error.
 */
export function rsi(closes: readonly number[], period = 14): Series {
  const out: Series = new Array(closes.length).fill(null)
  if (closes.length <= period) return out

  const gains: number[] = []
  const losses: number[] = []
  for (let i = 1; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1]
    gains.push(Math.max(change, 0))
    losses.push(Math.max(-change, 0))
  }

  const avgGain = wilderSmooth(gains, period)
  const avgLoss = wilderSmooth(losses, period)

  for (let i = 0; i < gains.length; i += 1) {
    const g = avgGain[i]
    const l = avgLoss[i]
    if (g === null || l === null) continue
    // `gains` is offset by one from `closes` (it holds differences), so index i maps to close i+1.
    out[i + 1] = quantize(l === 0 ? 100 : 100 - 100 / (1 + g / l))
  }
  return out
}

// ---------------------------------------------------------------- MACD

export type MacdResult = { macd: Series; signal: Series; histogram: Series }

/**
 * MACD(fast, slow, signal), the standard 12/26/9.
 *
 *   macd      = EMA(fast) − EMA(slow)
 *   signal    = EMA(macd, signal)
 *   histogram = macd − signal
 *
 * The signal EMA is seeded only from the bars where macd exists, then written back at the right
 * offset — computing it over an array padded with zeros would drag the early signal toward zero.
 */
export function macd(
  closes: readonly number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9,
): MacdResult {
  const emaFast = ema(closes, fast)
  const emaSlow = ema(closes, slow)

  const macdLine: Series = closes.map((_, i) =>
    emaFast[i] === null || emaSlow[i] === null ? null : quantize(emaFast[i]! - emaSlow[i]!),
  )

  const firstDefined = macdLine.findIndex((v) => v !== null)
  const signal: Series = new Array(closes.length).fill(null)
  const histogram: Series = new Array(closes.length).fill(null)

  if (firstDefined !== -1) {
    const dense = macdLine.slice(firstDefined).map((v) => v ?? 0)
    const signalDense = ema(dense, signalPeriod)
    for (let i = 0; i < signalDense.length; i += 1) {
      const value = signalDense[i]
      if (value === null) continue
      const index = firstDefined + i
      signal[index] = value
      histogram[index] = quantize((macdLine[index] ?? 0) - value)
    }
  }

  return { macd: macdLine, signal, histogram }
}

// ---------------------------------------------------------------- Bollinger Bands

export type BollingerResult = { middle: Series; upper: Series; lower: Series }

/**
 * Bollinger Bands: an SMA with bands at ±k population standard deviations.
 *
 * Population, not sample: the window *is* the population being described, and the sample form
 * (÷ n−1) would widen every band slightly against every reference implementation.
 */
export function bollingerBands(
  closes: readonly number[],
  period = 20,
  stdDevMultiplier = 2,
): BollingerResult {
  const middle = sma(closes, period)
  const upper: Series = new Array(closes.length).fill(null)
  const lower: Series = new Array(closes.length).fill(null)

  for (let i = period - 1; i < closes.length; i += 1) {
    const mean = middle[i]
    if (mean === null) continue
    let variance = 0
    for (let j = i - period + 1; j <= i; j += 1) variance += (closes[j] - mean) ** 2
    const sd = Math.sqrt(variance / period)
    upper[i] = quantize(mean + stdDevMultiplier * sd)
    lower[i] = quantize(mean - stdDevMultiplier * sd)
  }

  return { middle, upper, lower }
}

// ---------------------------------------------------------------- ATR

/** True range: the largest of today's spread, and each gap from yesterday's close. */
function trueRanges(candles: readonly Candle[]): number[] {
  const out: number[] = []
  for (let i = 1; i < candles.length; i += 1) {
    const c = candles[i]
    const previousClose = candles[i - 1].close
    out.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - previousClose),
        Math.abs(c.low - previousClose),
      ),
    )
  }
  return out
}

/** Average true range, Wilder-smoothed. A volatility measure, not a direction. */
export function atr(candles: readonly Candle[], period = 14): Series {
  const out: Series = new Array(candles.length).fill(null)
  if (candles.length <= period) return out

  const smoothed = wilderSmooth(trueRanges(candles), period)
  for (let i = 0; i < smoothed.length; i += 1) {
    if (smoothed[i] !== null) out[i + 1] = quantize(smoothed[i]!)
  }
  return out
}

// ---------------------------------------------------------------- ADX

export type AdxResult = { adx: Series; plusDi: Series; minusDi: Series }

/**
 * Average directional index, Wilder.
 *
 *   +DM = up move   when it exceeds the down move and is positive, else 0
 *   −DM = down move when it exceeds the up move   and is positive, else 0
 *   ±DI = 100 × smoothed(±DM) / smoothed(TR)
 *   DX  = 100 × |+DI − −DI| / (+DI + −DI)
 *   ADX = Wilder-smoothed DX
 *
 * ADX measures trend *strength* with no view on direction: a strong downtrend reads as high as a
 * strong uptrend. ±DI carry the direction.
 */
export function adx(candles: readonly Candle[], period = 14): AdxResult {
  const length = candles.length
  const empty = (): Series => new Array(length).fill(null)
  const result: AdxResult = { adx: empty(), plusDi: empty(), minusDi: empty() }
  if (length <= period * 2) return result

  const plusDm: number[] = []
  const minusDm: number[] = []
  for (let i = 1; i < length; i += 1) {
    const upMove = candles[i].high - candles[i - 1].high
    const downMove = candles[i - 1].low - candles[i].low
    plusDm.push(upMove > downMove && upMove > 0 ? upMove : 0)
    minusDm.push(downMove > upMove && downMove > 0 ? downMove : 0)
  }

  const tr = wilderSmooth(trueRanges(candles), period)
  const plus = wilderSmooth(plusDm, period)
  const minus = wilderSmooth(minusDm, period)

  const dx: number[] = []
  const dxOffset: number[] = []
  for (let i = 0; i < tr.length; i += 1) {
    if (tr[i] === null || plus[i] === null || minus[i] === null || tr[i] === 0) continue
    const pdi = (100 * plus[i]!) / tr[i]!
    const mdi = (100 * minus[i]!) / tr[i]!
    result.plusDi[i + 1] = quantize(pdi)
    result.minusDi[i + 1] = quantize(mdi)
    const sum = pdi + mdi
    dx.push(sum === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / sum)
    dxOffset.push(i + 1)
  }

  const smoothedDx = wilderSmooth(dx, period)
  for (let i = 0; i < smoothedDx.length; i += 1) {
    if (smoothedDx[i] !== null) result.adx[dxOffset[i]] = quantize(smoothedDx[i]!)
  }

  return result
}

// ---------------------------------------------------------------- volume

/**
 * Relative volume: today's volume against the average of the previous `period` sessions.
 *
 * The average deliberately **excludes** the current bar. Including it damps exactly the spike the
 * measure exists to detect — a 5× day would read as 4.2× on a 20-day window.
 */
export function relativeVolume(candles: readonly Candle[], period = 20): Series {
  const out: Series = new Array(candles.length).fill(null)

  for (let i = period; i < candles.length; i += 1) {
    const current = candles[i].volume
    if (current === null) continue

    let sum = 0
    let counted = 0
    for (let j = i - period; j < i; j += 1) {
      const v = candles[j].volume
      if (v === null) continue
      sum += v
      counted += 1
    }
    if (counted === 0 || sum === 0) continue
    out[i] = quantize(current / (sum / counted))
  }
  return out
}

/** Average volume over the trailing `period` sessions, current bar included. */
export function averageVolume(candles: readonly Candle[], period = 20): Series {
  const volumes = candles.map((c) => c.volume ?? 0)
  return sma(volumes, period)
}

// ---------------------------------------------------------------- crossings

export type Cross = "bullish" | "bearish" | null

/**
 * Whether series `a` crossed series `b` at the last bar.
 *
 * The same rule the alert engine uses, for the same reason: `a > b` is true on every bar of a
 * trend, so it says nothing about *when* anything happened. A cross needs both sides of the moment.
 *
 *   bullish: previous a <= previous b AND current a > current b
 *   bearish: previous a >= previous b AND current a < current b
 */
export function crossAt(a: Series, b: Series, index: number): Cross {
  if (index < 1) return null
  const a0 = a[index - 1]
  const b0 = b[index - 1]
  const a1 = a[index]
  const b1 = b[index]
  if (a0 === null || b0 === null || a1 === null || b1 === null) return null

  if (a0 <= b0 && a1 > b1) return "bullish"
  if (a0 >= b0 && a1 < b1) return "bearish"
  return null
}

/** The most recent bar index at which `a` crossed `b`, or null. */
export function lastCrossIndex(a: Series, b: Series): { index: number; cross: Cross } | null {
  for (let i = a.length - 1; i >= 1; i -= 1) {
    const cross = crossAt(a, b, i)
    if (cross) return { index: i, cross }
  }
  return null
}

/** The last non-null value of a series, with its index. */
export function latest(series: Series): { value: number; index: number } | null {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const value = series[i]
    if (value !== null) return { value, index: i }
  }
  return null
}
