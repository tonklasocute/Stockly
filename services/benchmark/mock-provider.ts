import type { Candle, Range } from "@/services/market-data/types"
import type { BenchmarkDefinition, BenchmarkProvider } from "./types"

/**
 * A deterministic index series, so benchmark comparison is usable — and testable — without a
 * provider plan that includes index data. Selected with BENCHMARK_PROVIDER=mock, which is what a
 * deployment on a free market-data tier will be running.
 *
 * The series is a smooth upward drift with a periodic wobble, seeded from the benchmark's code so
 * two indices are not the same line. It is obviously synthetic and is labelled as such in the UI;
 * the point is to exercise the comparison arithmetic, not to imitate a real market.
 */
const POINTS: Record<Range, number> = {
  "1D": 78,
  "1W": 65,
  "1M": 22,
  "3M": 65,
  "6M": 130,
  "1Y": 252,
  "5Y": 260,
  MAX: 400,
}

/** A small integer from a string, so each benchmark gets its own deterministic shape. */
function seedOf(code: string): number {
  let seed = 0
  for (const character of code) seed = (seed * 31 + character.charCodeAt(0)) % 997
  return seed
}

export const mockBenchmarkProvider: BenchmarkProvider = {
  name: "mock",

  async supports() {
    return true
  },

  async getSeries(benchmark: BenchmarkDefinition, range: Range): Promise<Candle[]> {
    const count = POINTS[range]
    const seed = seedOf(benchmark.code)
    const drift = 0.0002 + (seed % 5) * 0.00004
    const amplitude = 0.04 + (seed % 7) * 0.004
    const dayMs = 86_400_000
    const end = Date.now()
    const base = 1000 + seed

    return Array.from({ length: count }, (_, i) => {
      const close = base * (1 + drift * i + Math.sin((i + seed) / 11) * amplitude)
      const at = new Date(end - (count - 1 - i) * dayMs)
      return {
        date: at.toISOString().slice(0, 10),
        open: close * 0.999,
        high: close * 1.004,
        low: close * 0.996,
        close,
        volume: null,
      }
    })
  },
}
