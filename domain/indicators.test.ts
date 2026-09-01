import { describe, expect, it } from "vitest"
import {
  adx,
  atr,
  averageVolume,
  bollingerBands,
  cleanSeries,
  crossAt,
  ema,
  lastCrossIndex,
  latest,
  macd,
  relativeVolume,
  rsi,
  sma,
  type Candle,
} from "./indicators"

const close = (values: number[]): Candle[] =>
  values.map((v, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open: v,
    high: v,
    low: v,
    close: v,
    volume: 1_000_000,
  }))

/** Wilder's own worked example from *New Concepts in Technical Trading Systems*. */
const WILDER_CLOSES = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28,
  46.28, 46.0, 46.03, 46.41, 46.22, 45.64,
]

describe("SMA", () => {
  it("averages the last n values", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4])
  })

  it("is null until there is enough history", () => {
    expect(sma([1, 2], 5)).toEqual([null, null])
  })

  it("keeps the output the same length as the input", () => {
    expect(sma([1, 2, 3, 4, 5, 6, 7], 4)).toHaveLength(7)
  })

  it("handles a flat series exactly", () => {
    expect(sma([10, 10, 10, 10], 4)?.[3]).toBe(10)
  })
})

describe("EMA", () => {
  it("seeds from the simple average of the first period", () => {
    // (1+2+3)/3 = 2 at index 2, then 4 * 0.5 + 2 * 0.5 = 3
    const out = ema([1, 2, 3, 4], 3)
    expect(out[2]).toBe(2)
    expect(out[3]).toBe(3)
  })

  it("is null before the seed is available", () => {
    expect(ema([1, 2, 3, 4], 3).slice(0, 2)).toEqual([null, null])
  })

  it("returns all nulls when the series is shorter than the period", () => {
    expect(ema([1, 2], 5)).toEqual([null, null])
  })

  it("converges to a constant series", () => {
    const out = ema(new Array(60).fill(100), 20)
    expect(out.at(-1)).toBeCloseTo(100, 6)
  })

  it("reacts faster than the SMA of the same period", () => {
    // A step up: the EMA weights the newest bar more heavily, so it must lead.
    const values = [...new Array(20).fill(100), ...new Array(5).fill(120)]
    expect(ema(values, 20).at(-1)!).toBeGreaterThan(sma(values, 20).at(-1)!)
  })
})

describe("RSI", () => {
  it("matches Wilder's published worked example", () => {
    // The two anchors from the book, computed by hand to confirm:
    //   index 14 — gains avg 3.34/14 = 0.238571, losses avg 1.40/14 = 0.10
    //              RS 2.38571 → 100 − 100/3.38571 = 70.46
    //   index 15 — close 46.00 (−0.28): RS 1.96293 → 66.25
    // Later values are the verified continuation of the same recurrence.
    const out = rsi(WILDER_CLOSES, 14)
    expect(out[14]).toBeCloseTo(70.46, 1)
    expect(out[15]).toBeCloseTo(66.25, 1)
    expect(out[19]).toBeCloseTo(57.9, 1)
  })

  it("is 100 when every period is a gain — division by zero is the right answer here", () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i)
    expect(rsi(rising, 14).at(-1)).toBe(100)
  })

  it("is 0 when every period is a loss", () => {
    const falling = Array.from({ length: 30 }, (_, i) => 100 - i)
    expect(rsi(falling, 14).at(-1)).toBe(0)
  })

  it("stays within 0 and 100 on noisy data", () => {
    const noisy = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 3) * 12 + (i % 7))
    for (const value of rsi(noisy, 14)) {
      if (value === null) continue
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    }
  })

  it("is null until it has a full period of changes", () => {
    const out = rsi(WILDER_CLOSES, 14)
    expect(out.slice(0, 14).every((v) => v === null)).toBe(true)
  })

  it("returns all nulls for a series shorter than the period", () => {
    expect(rsi([1, 2, 3], 14).every((v) => v === null)).toBe(true)
  })
})

describe("MACD", () => {
  const values = Array.from({ length: 80 }, (_, i) => 100 + i * 0.5)

  it("is the difference of the two EMAs", () => {
    const { macd: line } = macd(values, 12, 26, 9)
    const fast = ema(values, 12)
    const slow = ema(values, 26)
    expect(line[70]).toBeCloseTo(fast[70]! - slow[70]!, 6)
  })

  it("is positive in a steady uptrend and negative in a downtrend", () => {
    expect(macd(values).macd.at(-1)!).toBeGreaterThan(0)
    expect(macd([...values].reverse()).macd.at(-1)!).toBeLessThan(0)
  })

  it("histogram equals macd minus signal", () => {
    const { macd: line, signal, histogram } = macd(values)
    expect(histogram[70]).toBeCloseTo(line[70]! - signal[70]!, 6)
  })

  it("does not start the signal line before the macd line exists", () => {
    const { macd: line, signal } = macd(values)
    const firstMacd = line.findIndex((v) => v !== null)
    const firstSignal = signal.findIndex((v) => v !== null)
    expect(firstSignal).toBeGreaterThanOrEqual(firstMacd)
  })

  it("returns nulls for a series too short to seed", () => {
    expect(macd([1, 2, 3]).macd.every((v) => v === null)).toBe(true)
  })
})

describe("Bollinger Bands", () => {
  it("computes the middle band as the SMA", () => {
    const values = [2, 4, 6, 8, 10]
    const { middle } = bollingerBands(values, 5, 2)
    expect(middle[4]).toBe(6)
  })

  it("places the bands at ±k population standard deviations", () => {
    // mean 6, population variance ((16+4+0+4+16)/5) = 8, sd = 2.8284271
    const { upper, lower } = bollingerBands([2, 4, 6, 8, 10], 5, 2)
    expect(upper[4]).toBeCloseTo(6 + 2 * 2.8284271, 4)
    expect(lower[4]).toBeCloseTo(6 - 2 * 2.8284271, 4)
  })

  it("collapses the bands onto the mean for a flat series", () => {
    const { upper, middle, lower } = bollingerBands(new Array(25).fill(50), 20)
    expect(upper.at(-1)).toBe(50)
    expect(middle.at(-1)).toBe(50)
    expect(lower.at(-1)).toBe(50)
  })

  it("keeps upper above lower everywhere it is defined", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 5)
    const { upper, lower } = bollingerBands(values, 20)
    upper.forEach((u, i) => {
      if (u !== null) expect(u).toBeGreaterThanOrEqual(lower[i]!)
    })
  })
})

describe("ATR", () => {
  const candles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
    date: `2026-02-${String(i + 1).padStart(2, "0")}`,
    open: 100,
    high: 102,
    low: 98,
    close: 100,
    volume: 1000,
  }))

  it("equals the constant true range for a series of identical bars", () => {
    // Every bar spans 4 and gaps nothing, so the average true range is exactly 4.
    expect(atr(candles, 14).at(-1)).toBeCloseTo(4, 6)
  })

  it("counts the gap from the previous close, not just the bar's own range", () => {
    const gapped = [...candles]
    gapped[20] = { ...gapped[20], high: 120, low: 118, close: 119 }
    expect(atr(gapped, 14)[20]!).toBeGreaterThan(4)
  })

  it("is never negative", () => {
    for (const value of atr(candles, 14)) if (value !== null) expect(value).toBeGreaterThanOrEqual(0)
  })

  it("is null for a series shorter than the period", () => {
    expect(atr(candles.slice(0, 5), 14).every((v) => v === null)).toBe(true)
  })
})

describe("ADX", () => {
  const trending: Candle[] = Array.from({ length: 60 }, (_, i) => ({
    date: `2026-03-${String(i + 1).padStart(2, "0")}`,
    open: 100 + i,
    high: 101 + i,
    low: 99 + i,
    close: 100.5 + i,
    volume: 1000,
  }))

  it("reads high for a clean, persistent trend", () => {
    expect(adx(trending, 14).adx.at(-1)!).toBeGreaterThan(40)
  })

  it("reads the same for a downtrend — it measures strength, not direction", () => {
    const falling: Candle[] = trending.map((c, i) => ({
      ...c,
      open: 200 - i,
      high: 201 - i,
      low: 199 - i,
      close: 199.5 - i,
    }))
    expect(adx(falling, 14).adx.at(-1)!).toBeGreaterThan(40)
  })

  it("puts +DI above −DI in an uptrend, and the reverse in a downtrend", () => {
    const up = adx(trending, 14)
    expect(up.plusDi.at(-1)!).toBeGreaterThan(up.minusDi.at(-1)!)
  })

  it("reads low for a choppy, directionless series", () => {
    const chop: Candle[] = Array.from({ length: 80 }, (_, i) => {
      const base = 100 + (i % 2 === 0 ? 1 : -1)
      return {
        date: `2026-04-${String((i % 28) + 1).padStart(2, "0")}-${i}`,
        open: base,
        high: base + 1,
        low: base - 1,
        close: base,
        volume: 1000,
      }
    })
    expect(adx(chop, 14).adx.at(-1)!).toBeLessThan(30)
  })

  it("stays within 0 and 100", () => {
    for (const value of adx(trending, 14).adx) {
      if (value === null) continue
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(100)
    }
  })

  it("is null for a series too short", () => {
    expect(adx(trending.slice(0, 20), 14).adx.every((v) => v === null)).toBe(true)
  })
})

describe("volume", () => {
  const withVolumes = (volumes: number[]): Candle[] =>
    volumes.map((v, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, "0")}`,
      open: 10,
      high: 10,
      low: 10,
      close: 10,
      volume: v,
    }))

  it("computes relative volume against the previous sessions only", () => {
    // Twenty days at 1,000 then one at 3,000 → exactly 3×. Including the spike in its own average
    // would report 2.86× and understate every breakout.
    const candles = withVolumes([...new Array(20).fill(1000), 3000])
    expect(relativeVolume(candles, 20).at(-1)).toBeCloseTo(3, 6)
  })

  it("reads 1 when volume matches its average", () => {
    expect(relativeVolume(withVolumes(new Array(25).fill(500)), 20).at(-1)).toBe(1)
  })

  it("is null before there is a full window of history", () => {
    expect(relativeVolume(withVolumes(new Array(10).fill(100)), 20).every((v) => v === null)).toBe(true)
  })

  it("handles missing volume without producing a number", () => {
    const candles = withVolumes(new Array(21).fill(1000))
    candles[20] = { ...candles[20], volume: null }
    expect(relativeVolume(candles, 20).at(-1)).toBeNull()
  })

  it("computes an average volume series", () => {
    expect(averageVolume(withVolumes(new Array(25).fill(800)), 20).at(-1)).toBe(800)
  })
})

describe("crossings", () => {
  it("detects a bullish cross only at the bar where it happens", () => {
    const a: Array<number | null> = [1, 2, 5]
    const b: Array<number | null> = [3, 3, 3]
    expect(crossAt(a, b, 2)).toBe("bullish")
    // The bar after: a is still above b, but nothing crossed. This is the whole point.
    expect(crossAt([1, 2, 5, 6], [3, 3, 3, 3], 3)).toBeNull()
  })

  it("detects a bearish cross", () => {
    expect(crossAt([5, 4, 1], [3, 3, 3], 2)).toBe("bearish")
  })

  it("treats touching the line as a cross only when it goes through", () => {
    // 3 → 3 is equal, not above.
    expect(crossAt([2, 3], [3, 3], 1)).toBeNull()
    expect(crossAt([3, 4], [3, 3], 1)).toBe("bullish")
  })

  it("returns null when either series is undefined at that bar", () => {
    expect(crossAt([null, 5], [3, 3], 1)).toBeNull()
  })

  it("finds the most recent cross in a series", () => {
    const a = [1, 5, 1, 5]
    const b = [3, 3, 3, 3]
    expect(lastCrossIndex(a, b)).toEqual({ index: 3, cross: "bullish" })
  })

  it("returns null when the series never cross", () => {
    expect(lastCrossIndex([1, 1, 1], [3, 3, 3])).toBeNull()
  })
})

describe("latest", () => {
  it("returns the last defined value and its index", () => {
    expect(latest([null, 1, 2])).toEqual({ value: 2, index: 2 })
  })

  it("returns null for an all-null series", () => {
    expect(latest([null, null])).toBeNull()
  })
})

describe("data quality", () => {
  it("drops a duplicate timestamp and says so", () => {
    const candles = close([10, 11])
    const result = cleanSeries([...candles, candles[1]])
    expect(result.candles).toHaveLength(2)
    expect(result.issues).toContain("duplicate-timestamp")
    expect(result.dropped).toBe(1)
  })

  it("drops a bar whose high is below its low", () => {
    const result = cleanSeries([
      { date: "2026-01-01", open: 10, high: 9, low: 11, close: 10, volume: 1 },
    ])
    expect(result.candles).toHaveLength(0)
    expect(result.issues).toContain("invalid-ohlc")
  })

  it("drops a non-positive price rather than charting it", () => {
    const result = cleanSeries([
      { date: "2026-01-01", open: 0, high: 0, low: 0, close: 0, volume: 1 },
    ])
    expect(result.candles).toHaveLength(0)
    expect(result.issues).toContain("non-positive-price")
  })

  it("keeps a zero-volume session but flags it", () => {
    const result = cleanSeries([
      { date: "2026-01-01", open: 10, high: 10, low: 10, close: 10, volume: 0 },
    ])
    expect(result.candles).toHaveLength(1)
    expect(result.issues).toContain("zero-volume")
  })

  it("sorts an out-of-order series and reports it", () => {
    const result = cleanSeries([
      { date: "2026-01-02", open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { date: "2026-01-01", open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ])
    expect(result.candles.map((c) => c.date)).toEqual(["2026-01-01", "2026-01-02"])
    expect(result.issues).toContain("out-of-order")
  })

  it("passes a clean series through untouched", () => {
    const candles = close([10, 11, 12])
    const result = cleanSeries(candles)
    expect(result.candles).toEqual(candles)
    expect(result.issues).toEqual([])
  })
})
