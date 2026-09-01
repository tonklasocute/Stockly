import { describe, expect, it } from "vitest"
import type { Candle } from "./indicators"
import {
  analyze,
  classifyStage,
  classifyTrend,
  collectSignals,
  scoreTechnicals,
  SCORE_VERSION,
  THRESHOLDS,
  type TechnicalSnapshot,
} from "./technical"

/** A long, clean uptrend — enough bars for every indicator to be defined. */
function uptrend(length = 260, start = 100, step = 0.4): Candle[] {
  return Array.from({ length }, (_, i) => {
    const base = start + i * step
    return {
      date: new Date(Date.UTC(2025, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      open: base,
      high: base + 1,
      low: base - 1,
      close: base + 0.2,
      volume: 1_000_000,
    }
  })
}

const snapshotBase = (over: Partial<TechnicalSnapshot> = {}): Omit<
  TechnicalSnapshot,
  "score" | "components" | "scoreVersion"
> => ({
  symbol: "TEST",
  price: 110,
  asOf: "2026-01-01",
  rsi: 58,
  macd: 1.2,
  macdSignal: 0.8,
  macdHistogram: 0.4,
  macdCross: null,
  emaCross5020: null,
  emaCross50200: null,
  adx: 28,
  plusDi: 30,
  minusDi: 15,
  atr: 2,
  atrPct: 1.8,
  relativeVolume: 1.6,
  averageVolume: 1_000_000,
  bollingerUpper: 118,
  bollingerMiddle: 110,
  bollingerLower: 102,
  ema: { 20: 108, 50: 105, 100: 100, 200: 95, 9: 109, 150: 98 },
  sma: { 20: 108, 50: 105, 100: 100, 200: 95 },
  trend: "bullish",
  stage: "uptrend",
  signals: [],
  candleCount: 260,
  dataIssues: [],
  ...over,
})

describe("trend classification", () => {
  it("is bullish only when price and both EMAs line up", () => {
    expect(classifyTrend(110, 105, 100)).toBe("bullish")
  })

  it("is bearish when they line up the other way", () => {
    expect(classifyTrend(90, 95, 100)).toBe("bearish")
  })

  it("is neutral for a mixed picture rather than forcing a direction", () => {
    // Above the 50 but the 50 is below the 200: genuinely mixed, and saying so is more useful.
    expect(classifyTrend(110, 105, 120)).toBe("neutral")
  })

  it("is neutral when an EMA is not yet defined", () => {
    expect(classifyTrend(110, null, 100)).toBe("neutral")
    expect(classifyTrend(null, 105, 100)).toBe("neutral")
  })
})

describe("market stage", () => {
  it("calls price above a rising 200 an uptrend", () => {
    expect(classifyStage(120, 110, 100)).toBe("uptrend")
  })

  it("calls price below a falling 200 a downtrend", () => {
    expect(classifyStage(90, 100, 110)).toBe("downtrend")
  })

  it("calls price above a rolling-over 200 distribution", () => {
    expect(classifyStage(105, 100, 104)).toBe("distribution")
  })

  it("calls price below a flat 200 accumulation", () => {
    expect(classifyStage(95, 100, 100)).toBe("accumulation")
  })

  it("is unknown without enough history", () => {
    expect(classifyStage(100, null, null)).toBe("unknown")
  })
})

describe("technical score", () => {
  it("is explainable — every component carries its reason", () => {
    const { score, components } = scoreTechnicals(snapshotBase())
    expect(score).not.toBeNull()
    expect(components.length).toBeGreaterThan(0)
    for (const component of components) {
      expect(component.reason.length).toBeGreaterThan(0)
      expect(component.points).toBeLessThanOrEqual(component.max)
      expect(component.points).toBeGreaterThanOrEqual(0)
    }
  })

  it("sums to the reported score", () => {
    const { score, components } = scoreTechnicals(snapshotBase())
    const earned = components.reduce((s, c) => s + c.points, 0)
    const possible = components.reduce((s, c) => s + c.max, 0)
    expect(score).toBe(Math.round((earned / possible) * 100))
  })

  it("scores a clean uptrend higher than a clean downtrend", () => {
    const bearish = scoreTechnicals(
      snapshotBase({
        price: 90,
        rsi: 32,
        macd: -1.2,
        macdSignal: -0.8,
        adx: 28,
        plusDi: 12,
        minusDi: 30,
        relativeVolume: 0.6,
        ema: { 20: 95, 50: 100, 100: 105, 200: 110, 9: 93, 150: 108 },
      }),
    )
    expect(scoreTechnicals(snapshotBase()).score!).toBeGreaterThan(bearish.score!)
  })

  it("scores out of what is knowable, not penalising missing history", () => {
    // No ADX and no ATR: those components are absent, and the rest are scored on their own terms.
    const partial = scoreTechnicals(snapshotBase({ adx: null, plusDi: null, minusDi: null, atrPct: null }))
    expect(partial.components.map((c) => c.key)).not.toContain("structure")
    expect(partial.score).not.toBeNull()
  })

  it("is null when nothing at all is computable", () => {
    const empty = scoreTechnicals(
      snapshotBase({
        price: null,
        rsi: null,
        macd: null,
        macdSignal: null,
        adx: null,
        atrPct: null,
        relativeVolume: null,
        ema: {},
        sma: {},
      }),
    )
    expect(empty.score).toBeNull()
    expect(empty.components).toEqual([])
  })

  it("stays within 0 and 100", () => {
    for (const rsi of [5, 30, 50, 65, 95]) {
      const { score } = scoreTechnicals(snapshotBase({ rsi }))
      expect(score!).toBeGreaterThanOrEqual(0)
      expect(score!).toBeLessThanOrEqual(100)
    }
  })

  it("uses named thresholds, not literals", () => {
    // The RSI band that earns full momentum points is the documented one.
    const inBand = scoreTechnicals(snapshotBase({ rsi: THRESHOLDS.rsi.neutralHigh }))
    const belowBand = scoreTechnicals(snapshotBase({ rsi: THRESHOLDS.rsi.neutralHigh - 1 }))
    expect(inBand.score!).toBeGreaterThan(belowBand.score!)
  })
})

describe("signals", () => {
  it("describes conditions, never actions", () => {
    const signals = collectSignals(snapshotBase())
    expect(signals).toContain("PRICE_ABOVE_EMA200")
    expect(signals).toContain("MACD_BULLISH")
    // Nothing in the vocabulary tells anyone to trade.
    for (const signal of signals) {
      expect(signal).not.toMatch(/BUY|SELL|TARGET|GUARANTEE/)
    }
  })

  it("reports oversold and overbought separately from neutral", () => {
    expect(collectSignals(snapshotBase({ rsi: 25 }))).toContain("RSI_OVERSOLD")
    expect(collectSignals(snapshotBase({ rsi: 75 }))).toContain("RSI_OVERBOUGHT")
    expect(collectSignals(snapshotBase({ rsi: 50 }))).toContain("RSI_NEUTRAL")
  })

  it("reports a golden cross only on the bar it happened", () => {
    expect(collectSignals(snapshotBase({ emaCross50200: "bullish" }))).toContain("GOLDEN_CROSS")
    expect(collectSignals(snapshotBase({ emaCross50200: null }))).not.toContain("GOLDEN_CROSS")
  })

  it("distinguishes elevated volume from a spike", () => {
    expect(collectSignals(snapshotBase({ relativeVolume: 1.6 }))).toContain("HIGH_RELATIVE_VOLUME")
    expect(collectSignals(snapshotBase({ relativeVolume: 2.5 }))).toContain("VOLUME_SPIKE")
    expect(collectSignals(snapshotBase({ relativeVolume: 0.5 }))).toContain("LOW_RELATIVE_VOLUME")
  })

  it("emits nothing for an indicator that is not computable", () => {
    const signals = collectSignals(snapshotBase({ rsi: null, adx: null, relativeVolume: null }))
    expect(signals.some((s) => s.startsWith("RSI"))).toBe(false)
    expect(signals).not.toContain("STRONG_TREND")
  })
})

describe("analyze", () => {
  it("produces a complete snapshot from a long series", () => {
    const snapshot = analyze("TEST", uptrend())
    expect(snapshot.price).not.toBeNull()
    expect(snapshot.rsi).not.toBeNull()
    expect(snapshot.adx).not.toBeNull()
    expect(snapshot.ema[200]).not.toBeNull()
    expect(snapshot.trend).toBe("bullish")
    expect(snapshot.score).not.toBeNull()
    expect(snapshot.scoreVersion).toBe(SCORE_VERSION)
  })

  it("degrades gracefully on a short series instead of throwing", () => {
    const snapshot = analyze("TEST", uptrend(10))
    expect(snapshot.candleCount).toBe(10)
    expect(snapshot.ema[200]).toBeNull()
    expect(snapshot.trend).toBe("neutral")
  })

  it("handles an empty series", () => {
    const snapshot = analyze("TEST", [])
    expect(snapshot.price).toBeNull()
    expect(snapshot.score).toBeNull()
    expect(snapshot.candleCount).toBe(0)
  })

  it("cleans the series before computing, and reports what it found", () => {
    const candles = uptrend(260)
    const dirty = [...candles, candles[10]] // a duplicated bar from a provider retry
    const snapshot = analyze("TEST", dirty)
    expect(snapshot.dataIssues).toContain("duplicate-timestamp")
    expect(snapshot.candleCount).toBe(260)
  })

  it("reads a downtrend as bearish", () => {
    const falling = uptrend(260, 200, -0.4)
    expect(analyze("TEST", falling).trend).toBe("bearish")
  })

  it("expresses ATR as a percentage of price, which is comparable across stocks", () => {
    const snapshot = analyze("TEST", uptrend())
    expect(snapshot.atrPct).toBeGreaterThan(0)
    expect(snapshot.atrPct).toBeLessThan(20)
  })
})
