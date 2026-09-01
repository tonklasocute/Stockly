import {
  adx as calcAdx,
  atr as calcAtr,
  bollingerBands,
  cleanSeries,
  crossAt,
  ema,
  latest,
  macd as calcMacd,
  relativeVolume,
  rsi as calcRsi,
  sma,
  type Candle,
  type Cross,
  type SeriesIssue,
} from "./indicators"
import { quantize } from "./money"

/**
 * Technical analysis: turning indicators into a description of what a chart currently looks like.
 *
 * This is description, not prediction. Nothing here forecasts a price or recommends a trade; every
 * output states a condition that is measurably true right now, and every score component says which
 * rule produced it. See docs/TECHNICAL-ANALYSIS.md.
 */

/** Bumped whenever a rule or weight below changes, so an old stored score is still interpretable. */
export const SCORE_VERSION = "v1"

/**
 * Every threshold, named. A bare `if (rsi < 27.4)` in the middle of a scoring function is a number
 * nobody can defend or tune; these are the conventional levels, in one place.
 */
export const THRESHOLDS = {
  rsi: { oversold: 30, weak: 45, neutralHigh: 55, strong: 70 },
  adx: { weakTrend: 20, strongTrend: 25, veryStrongTrend: 40 },
  relativeVolume: { elevated: 1.5, spike: 2 },
  /** Distance from a moving average, in percent, within which price counts as "at" it. */
  maProximityPct: 2,
  /** ATR as a percentage of price, above which the stock counts as volatile. */
  atrPct: { calm: 2, volatile: 4 },
} as const

export const PERIODS = {
  rsi: 14,
  atr: 14,
  adx: 14,
  macd: { fast: 12, slow: 26, signal: 9 },
  bollinger: { period: 20, stdDev: 2 },
  volume: 20,
  ema: [9, 20, 50, 100, 150, 200] as const,
  sma: [20, 50, 100, 200] as const,
} as const

export type Trend = "bullish" | "bearish" | "neutral"

/**
 * A four-stage classification of where a chart sits, after Stan Weinstein.
 *
 * **A heuristic label, not a market forecast.** It says what the price has done relative to its
 * 200-period average and its slope — nothing about what happens next.
 */
export type MarketStage = "accumulation" | "uptrend" | "distribution" | "downtrend" | "unknown"

export type SignalCode =
  | "PRICE_ABOVE_EMA200"
  | "PRICE_BELOW_EMA200"
  | "PRICE_ABOVE_EMA50"
  | "PRICE_BELOW_EMA50"
  | "GOLDEN_CROSS"
  | "DEATH_CROSS"
  | "MACD_BULLISH"
  | "MACD_BEARISH"
  | "MACD_BULLISH_CROSS"
  | "MACD_BEARISH_CROSS"
  | "RSI_OVERSOLD"
  | "RSI_OVERBOUGHT"
  | "RSI_NEUTRAL"
  | "STRONG_TREND"
  | "WEAK_TREND"
  | "HIGH_RELATIVE_VOLUME"
  | "VOLUME_SPIKE"
  | "LOW_RELATIVE_VOLUME"
  | "ABOVE_UPPER_BAND"
  | "BELOW_LOWER_BAND"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"

export const SIGNAL_LABELS: Record<SignalCode, string> = {
  PRICE_ABOVE_EMA200: "Price above the 200 EMA",
  PRICE_BELOW_EMA200: "Price below the 200 EMA",
  PRICE_ABOVE_EMA50: "Price above the 50 EMA",
  PRICE_BELOW_EMA50: "Price below the 50 EMA",
  GOLDEN_CROSS: "50 EMA crossed above the 200 EMA",
  DEATH_CROSS: "50 EMA crossed below the 200 EMA",
  MACD_BULLISH: "MACD above its signal line",
  MACD_BEARISH: "MACD below its signal line",
  MACD_BULLISH_CROSS: "MACD crossed above its signal line",
  MACD_BEARISH_CROSS: "MACD crossed below its signal line",
  RSI_OVERSOLD: "RSI below 30",
  RSI_OVERBOUGHT: "RSI above 70",
  RSI_NEUTRAL: "RSI between 45 and 55",
  STRONG_TREND: "ADX above 25",
  WEAK_TREND: "ADX below 20",
  HIGH_RELATIVE_VOLUME: "Volume above 1.5× its average",
  VOLUME_SPIKE: "Volume above 2× its average",
  LOW_RELATIVE_VOLUME: "Volume below its average",
  ABOVE_UPPER_BAND: "Price above the upper Bollinger band",
  BELOW_LOWER_BAND: "Price below the lower Bollinger band",
  HIGH_VOLATILITY: "ATR above 4% of price",
  LOW_VOLATILITY: "ATR below 2% of price",
}

/** One component of the score, with the reason it was awarded. */
export type ScoreComponent = {
  key: "trend" | "momentum" | "volume" | "volatility" | "structure"
  label: string
  /** Points awarded, out of `max`. */
  points: number
  max: number
  reason: string
}

export type TechnicalSnapshot = {
  symbol: string
  /** The close the indicators were computed from. */
  price: number | null
  asOf: string | null

  rsi: number | null
  macd: number | null
  macdSignal: number | null
  macdHistogram: number | null
  macdCross: Cross
  emaCross5020: Cross
  emaCross50200: Cross
  adx: number | null
  plusDi: number | null
  minusDi: number | null
  atr: number | null
  /** ATR as a percentage of price — comparable across stocks, unlike ATR itself. */
  atrPct: number | null
  relativeVolume: number | null
  averageVolume: number | null
  bollingerUpper: number | null
  bollingerMiddle: number | null
  bollingerLower: number | null
  ema: Record<number, number | null>
  sma: Record<number, number | null>

  trend: Trend
  stage: MarketStage
  signals: SignalCode[]
  score: number | null
  scoreVersion: string
  components: ScoreComponent[]

  /** How many usable candles the analysis is based on. Fewer means less is computable. */
  candleCount: number
  dataIssues: SeriesIssue[]
}

const pct = (a: number, b: number) => ((a - b) / b) * 100

/**
 * Trend, from the documented rule:
 *
 *   bullish  price > EMA50 AND EMA50 > EMA200
 *   bearish  price < EMA50 AND EMA50 < EMA200
 *   neutral  anything else — including every case where the EMAs are not yet defined
 *
 * Deliberately conservative: a stock above its 50 but below its 200 is not "half bullish", it is
 * mixed, and saying so is more useful than forcing it into a direction.
 */
export function classifyTrend(
  price: number | null,
  ema50: number | null,
  ema200: number | null,
): Trend {
  if (price === null || ema50 === null || ema200 === null) return "neutral"
  if (price > ema50 && ema50 > ema200) return "bullish"
  if (price < ema50 && ema50 < ema200) return "bearish"
  return "neutral"
}

/**
 * Market stage — a heuristic label, never a forecast.
 *
 *   uptrend        price above a rising 200
 *   downtrend      price below a falling 200
 *   accumulation   price below or at a flat/rising 200 — basing
 *   distribution   price above a flattening or falling 200 — topping
 *
 * "Rising" and "falling" are measured against the 200 average twenty bars ago, so a single day
 * cannot flip the classification.
 */
export function classifyStage(
  price: number | null,
  ma200Now: number | null,
  ma200Earlier: number | null,
): MarketStage {
  if (price === null || ma200Now === null || ma200Earlier === null) return "unknown"

  const slopePct = pct(ma200Now, ma200Earlier)
  const rising = slopePct > 0.5
  const falling = slopePct < -0.5
  const above = price > ma200Now

  if (above && rising) return "uptrend"
  if (!above && falling) return "downtrend"
  if (above) return "distribution"
  return "accumulation"
}

/**
 * The technical score, 0–100.
 *
 * Five weighted components, each capped and each carrying the sentence that explains it. The total
 * is the sum of what was actually awarded over the sum of what could be — so a stock whose ADX is
 * not yet computable is scored out of what is known rather than penalised for missing history.
 *
 * It describes the current chart. It is not a rating, a recommendation, or a forecast.
 */
export function scoreTechnicals(snapshot: Omit<TechnicalSnapshot, "score" | "components" | "scoreVersion">): {
  score: number | null
  components: ScoreComponent[]
} {
  const components: ScoreComponent[] = []
  const { price } = snapshot
  const ema50 = snapshot.ema[50] ?? null
  const ema200 = snapshot.ema[200] ?? null

  // ---- trend, 25
  if (price !== null && ema50 !== null && ema200 !== null) {
    let points = 0
    const reasons: string[] = []
    if (price > ema200) {
      points += 10
      reasons.push("price above the 200 EMA")
    }
    if (price > ema50) {
      points += 8
      reasons.push("price above the 50 EMA")
    }
    if (ema50 > ema200) {
      points += 7
      reasons.push("50 EMA above the 200 EMA")
    }
    components.push({
      key: "trend",
      label: "Trend",
      points,
      max: 25,
      reason: reasons.length ? reasons.join(", ") : "price below both moving averages",
    })
  }

  // ---- momentum, 25 — MACD position and RSI band
  if (snapshot.macd !== null && snapshot.macdSignal !== null) {
    let points = 0
    const reasons: string[] = []
    if (snapshot.macd > snapshot.macdSignal) {
      points += 10
      reasons.push("MACD above its signal")
    }
    if (snapshot.macd > 0) {
      points += 5
      reasons.push("MACD above zero")
    }
    if (snapshot.rsi !== null) {
      if (snapshot.rsi >= THRESHOLDS.rsi.neutralHigh && snapshot.rsi < THRESHOLDS.rsi.strong) {
        points += 10
        reasons.push("RSI in the 55–70 band")
      } else if (snapshot.rsi >= THRESHOLDS.rsi.weak) {
        points += 5
        reasons.push("RSI mid-range")
      } else {
        reasons.push("RSI weak")
      }
    }
    components.push({
      key: "momentum",
      label: "Momentum",
      points,
      max: 25,
      reason: reasons.join(", "),
    })
  }

  // ---- structure, 20 — trend strength and direction agreement
  if (snapshot.adx !== null) {
    let points = 0
    const reasons: string[] = []
    if (snapshot.adx >= THRESHOLDS.adx.veryStrongTrend) {
      points += 12
      reasons.push("ADX above 40")
    } else if (snapshot.adx >= THRESHOLDS.adx.strongTrend) {
      points += 9
      reasons.push("ADX above 25")
    } else if (snapshot.adx >= THRESHOLDS.adx.weakTrend) {
      points += 4
      reasons.push("ADX between 20 and 25")
    } else {
      reasons.push("ADX below 20, no clear trend")
    }
    if (snapshot.plusDi !== null && snapshot.minusDi !== null && snapshot.plusDi > snapshot.minusDi) {
      points += 8
      reasons.push("+DI above −DI")
    }
    components.push({ key: "structure", label: "Structure", points, max: 20, reason: reasons.join(", ") })
  }

  // ---- volume, 20
  if (snapshot.relativeVolume !== null) {
    let points = 0
    let reason: string
    if (snapshot.relativeVolume >= THRESHOLDS.relativeVolume.spike) {
      points = 20
      reason = `volume ${snapshot.relativeVolume.toFixed(1)}× its average`
    } else if (snapshot.relativeVolume >= THRESHOLDS.relativeVolume.elevated) {
      points = 14
      reason = `volume ${snapshot.relativeVolume.toFixed(1)}× its average`
    } else if (snapshot.relativeVolume >= 1) {
      points = 10
      reason = "volume around its average"
    } else {
      points = 4
      reason = "volume below its average"
    }
    components.push({ key: "volume", label: "Volume", points, max: 20, reason })
  }

  // ---- volatility, 10 — calm scores higher; a violent chart is harder to read, not better
  if (snapshot.atrPct !== null) {
    let points: number
    let reason: string
    if (snapshot.atrPct <= THRESHOLDS.atrPct.calm) {
      points = 10
      reason = `ATR ${snapshot.atrPct.toFixed(1)}% of price, steady`
    } else if (snapshot.atrPct <= THRESHOLDS.atrPct.volatile) {
      points = 6
      reason = `ATR ${snapshot.atrPct.toFixed(1)}% of price`
    } else {
      points = 2
      reason = `ATR ${snapshot.atrPct.toFixed(1)}% of price, volatile`
    }
    components.push({ key: "volatility", label: "Volatility", points, max: 10, reason })
  }

  if (components.length === 0) return { score: null, components: [] }

  const earned = components.reduce((sum, c) => sum + c.points, 0)
  const possible = components.reduce((sum, c) => sum + c.max, 0)
  return { score: Math.round((earned / possible) * 100), components }
}

/** Every condition that is currently true. Descriptive labels only — never "buy" or "sell". */
export function collectSignals(
  snapshot: Omit<TechnicalSnapshot, "signals" | "score" | "components" | "scoreVersion">,
): SignalCode[] {
  const signals: SignalCode[] = []
  const { price } = snapshot
  const ema50 = snapshot.ema[50] ?? null
  const ema200 = snapshot.ema[200] ?? null

  if (price !== null && ema200 !== null) {
    signals.push(price > ema200 ? "PRICE_ABOVE_EMA200" : "PRICE_BELOW_EMA200")
  }
  if (price !== null && ema50 !== null) {
    signals.push(price > ema50 ? "PRICE_ABOVE_EMA50" : "PRICE_BELOW_EMA50")
  }
  if (snapshot.emaCross50200 === "bullish") signals.push("GOLDEN_CROSS")
  if (snapshot.emaCross50200 === "bearish") signals.push("DEATH_CROSS")

  if (snapshot.macd !== null && snapshot.macdSignal !== null) {
    signals.push(snapshot.macd > snapshot.macdSignal ? "MACD_BULLISH" : "MACD_BEARISH")
  }
  if (snapshot.macdCross === "bullish") signals.push("MACD_BULLISH_CROSS")
  if (snapshot.macdCross === "bearish") signals.push("MACD_BEARISH_CROSS")

  if (snapshot.rsi !== null) {
    if (snapshot.rsi < THRESHOLDS.rsi.oversold) signals.push("RSI_OVERSOLD")
    else if (snapshot.rsi > THRESHOLDS.rsi.strong) signals.push("RSI_OVERBOUGHT")
    else if (snapshot.rsi >= THRESHOLDS.rsi.weak && snapshot.rsi <= THRESHOLDS.rsi.neutralHigh) {
      signals.push("RSI_NEUTRAL")
    }
  }

  if (snapshot.adx !== null) {
    if (snapshot.adx > THRESHOLDS.adx.strongTrend) signals.push("STRONG_TREND")
    else if (snapshot.adx < THRESHOLDS.adx.weakTrend) signals.push("WEAK_TREND")
  }

  if (snapshot.relativeVolume !== null) {
    if (snapshot.relativeVolume >= THRESHOLDS.relativeVolume.spike) signals.push("VOLUME_SPIKE")
    else if (snapshot.relativeVolume >= THRESHOLDS.relativeVolume.elevated) {
      signals.push("HIGH_RELATIVE_VOLUME")
    } else if (snapshot.relativeVolume < 1) signals.push("LOW_RELATIVE_VOLUME")
  }

  if (price !== null && snapshot.bollingerUpper !== null && price > snapshot.bollingerUpper) {
    signals.push("ABOVE_UPPER_BAND")
  }
  if (price !== null && snapshot.bollingerLower !== null && price < snapshot.bollingerLower) {
    signals.push("BELOW_LOWER_BAND")
  }

  if (snapshot.atrPct !== null) {
    if (snapshot.atrPct > THRESHOLDS.atrPct.volatile) signals.push("HIGH_VOLATILITY")
    else if (snapshot.atrPct <= THRESHOLDS.atrPct.calm) signals.push("LOW_VOLATILITY")
  }

  return signals
}

/**
 * The single entry point: an OHLCV series in, one described snapshot out.
 *
 * The series is cleaned first — a duplicated bar or a low above its high would otherwise produce
 * an authoritative-looking number computed from bad data.
 */
export function analyze(symbol: string, rawCandles: readonly Candle[]): TechnicalSnapshot {
  const { candles, issues } = cleanSeries(rawCandles)
  const closes = candles.map((c) => c.close)
  const last = candles.length - 1

  const emaSeries = Object.fromEntries(PERIODS.ema.map((p) => [p, ema(closes, p)]))
  const smaSeries = Object.fromEntries(PERIODS.sma.map((p) => [p, sma(closes, p)]))
  const rsiSeries = calcRsi(closes, PERIODS.rsi)
  const macdResult = calcMacd(closes, PERIODS.macd.fast, PERIODS.macd.slow, PERIODS.macd.signal)
  const adxResult = calcAdx(candles, PERIODS.adx)
  const atrSeries = calcAtr(candles, PERIODS.atr)
  const rvolSeries = relativeVolume(candles, PERIODS.volume)
  const avgVolSeries = sma(candles.map((c) => c.volume ?? 0), PERIODS.volume)
  const bands = bollingerBands(closes, PERIODS.bollinger.period, PERIODS.bollinger.stdDev)

  const price = candles.length > 0 ? closes[last] : null
  const atrValue = latest(atrSeries)?.value ?? null
  const sma200 = smaSeries[200] ?? []

  const base = {
    symbol,
    price,
    asOf: candles.length > 0 ? candles[last].date : null,
    rsi: latest(rsiSeries)?.value ?? null,
    macd: latest(macdResult.macd)?.value ?? null,
    macdSignal: latest(macdResult.signal)?.value ?? null,
    macdHistogram: latest(macdResult.histogram)?.value ?? null,
    macdCross: crossAt(macdResult.macd, macdResult.signal, last),
    emaCross5020: crossAt(emaSeries[20] ?? [], emaSeries[50] ?? [], last),
    emaCross50200: crossAt(emaSeries[50] ?? [], emaSeries[200] ?? [], last),
    adx: latest(adxResult.adx)?.value ?? null,
    plusDi: latest(adxResult.plusDi)?.value ?? null,
    minusDi: latest(adxResult.minusDi)?.value ?? null,
    atr: atrValue,
    atrPct: atrValue !== null && price ? quantize((atrValue / price) * 100) : null,
    relativeVolume: latest(rvolSeries)?.value ?? null,
    averageVolume: latest(avgVolSeries)?.value ?? null,
    bollingerUpper: latest(bands.upper)?.value ?? null,
    bollingerMiddle: latest(bands.middle)?.value ?? null,
    bollingerLower: latest(bands.lower)?.value ?? null,
    ema: Object.fromEntries(
      PERIODS.ema.map((p) => [p, latest(emaSeries[p] ?? [])?.value ?? null]),
    ) as Record<number, number | null>,
    sma: Object.fromEntries(
      PERIODS.sma.map((p) => [p, latest(smaSeries[p] ?? [])?.value ?? null]),
    ) as Record<number, number | null>,
    trend: classifyTrend(price, latest(emaSeries[50] ?? [])?.value ?? null, latest(emaSeries[200] ?? [])?.value ?? null),
    stage: classifyStage(price, sma200[last] ?? null, sma200[last - 20] ?? null),
    candleCount: candles.length,
    dataIssues: issues,
  }

  const signals = collectSignals(base)
  const { score, components } = scoreTechnicals({ ...base, signals })

  return { ...base, signals, score, components, scoreVersion: SCORE_VERSION }
}
