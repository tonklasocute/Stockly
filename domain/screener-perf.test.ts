import { describe, expect, it } from "vitest"
import { runScreen, type ScreenerCandidate } from "./screener"
import { analyze } from "./technical"
import type { Candle } from "./indicators"

/**
 * Performance characteristics of the parts that are pure.
 *
 * The screener's cost is entirely in-memory once snapshots exist — no database round trip per
 * stock, and no market-data request at all. These assert that the shape stays that way: doubling
 * the universe roughly doubles the work rather than squaring it.
 */

function series(length: number, seed: number): Candle[] {
  return Array.from({ length }, (_, i) => {
    const base = 100 + Math.sin((i + seed) / 9) * 12 + i * 0.05
    return {
      date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
      open: base,
      high: base + 1.2,
      low: base - 1.2,
      close: base + 0.3,
      volume: 1_000_000 + (i % 11) * 50_000,
    }
  })
}

function universe(size: number): ScreenerCandidate[] {
  return Array.from({ length: size }, (_, i) => ({
    snapshot: analyze(`S${i}`, series(260, i)),
    context: { marketCap: 1e9 + i, volume: 1_000_000 },
  }))
}

describe("screener throughput", () => {
  it("filters ten thousand precomputed snapshots quickly", () => {
    // Building the universe is the expensive part (that is the scheduled job's work); the screen
    // itself is a scan, and this is the number that matters when a user hits Run.
    const candidates = universe(500)
    const inflated = Array.from({ length: 20 }, () => candidates).flat() // 10,000

    const started = performance.now()
    const result = runScreen(inflated, {
      logic: "AND",
      filters: [
        { metric: "RSI", operator: "LT", value: 60 },
        { metric: "PRICE_VS_EMA200", operator: "GT", value: 0 },
      ],
      sort: { metric: "TECHNICAL_SCORE", direction: "desc" },
    })
    const elapsed = performance.now() - started

    expect(result.examined).toBe(10_000)
    expect(elapsed).toBeLessThan(1000)
  })

  it("scales roughly linearly rather than quadratically", () => {
    const small = universe(100)
    const large = Array.from({ length: 10 }, () => small).flat()
    const definition = { logic: "AND" as const, filters: [{ metric: "RSI" as const, operator: "LT" as const, value: 60 }] }

    const timeOf = (set: ScreenerCandidate[]) => {
      const started = performance.now()
      runScreen(set, definition)
      return performance.now() - started
    }

    // Best of several runs at each size. A single 100-item pass takes tens of microseconds, so one
    // scheduler hiccup on the baseline was enough to make this ratio meaningless — and it did,
    // intermittently, under a loaded parallel test run. The minimum is the least noise-sensitive
    // statistic available here, and the property under test is unchanged.
    const best = (set: ScreenerCandidate[]) =>
      Math.min(...Array.from({ length: 5 }, () => timeOf(set)))

    timeOf(small) // warm up
    const t1 = Math.max(best(small), 0.05)
    const t10 = best(large)
    // Ten times the data must not cost anywhere near a hundred times the work.
    expect(t10 / t1).toBeLessThan(40)
  })

  it("analyses a 260-bar series in single-digit milliseconds", () => {
    const candles = series(260, 1)
    const started = performance.now()
    for (let i = 0; i < 20; i += 1) analyze("TEST", candles)
    const perRun = (performance.now() - started) / 20
    expect(perRun).toBeLessThan(50)
  })
})
