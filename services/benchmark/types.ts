import type { Candle, Range } from "@/services/market-data/types"

/**
 * Benchmark comparison — INTERFACE ONLY. Nothing implements this yet, and no UI reads it.
 *
 * Why it stops here: comparing a portfolio against an index needs the index's daily series over the
 * same window, and index data (^GSPC, ^IXIC, SET) is not on Twelve Data's free tier. Building a UI
 * against data we cannot fetch would ship a permanently empty chart.
 *
 * What is deliberately settled now, because it is the part that would be expensive to change later:
 * the shape of the comparison. A benchmark is normalised to the portfolio's own start value, so the
 * two lines answer "what would the same money have done" rather than being plotted on unrelated
 * axes. `ponytail:` ceiling — implement when a provider plan includes index series.
 */
export type BenchmarkId = "SPX" | "NDX" | "SET"

export type Benchmark = {
  id: BenchmarkId
  symbol: string
  name: string
  market: "US" | "SET"
}

export const BENCHMARKS: readonly Benchmark[] = [
  { id: "SPX", symbol: "^GSPC", name: "S&P 500", market: "US" },
  { id: "NDX", symbol: "^IXIC", name: "NASDAQ Composite", market: "US" },
  { id: "SET", symbol: "^SET", name: "SET Index", market: "SET" },
]

export interface BenchmarkProvider {
  readonly name: string
  /** Which benchmarks this provider's plan can actually serve. Empty is a valid answer. */
  available(): Promise<Benchmark[]>
  getSeries(id: BenchmarkId, range: Range): Promise<Candle[]>
}

/**
 * Rebases a benchmark onto the portfolio's starting value, so both lines begin at the same point
 * and the comparison is about rate of change, not absolute level.
 */
export function rebase(series: readonly Candle[], startValue: number): Array<{ date: string; value: number }> {
  const first = series[0]?.close
  if (!first || startValue <= 0) return []
  return series.map((candle) => ({ date: candle.date, value: (candle.close / first) * startValue }))
}
