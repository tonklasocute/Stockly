import type { Candle, Market, Range } from "@/services/market-data/types"
import type { Currency } from "@/domain/market"

/**
 * Benchmark comparison.
 *
 * Phase 3 settled the shape of this and stopped: index series (^GSPC, ^IXIC, ^SET) are not on
 * Twelve Data's free tier, and a UI built against data that cannot be fetched ships a permanently
 * empty chart. Phase 10 implements it, keeping that constraint in view — the adapter reports what
 * its plan can actually serve, and everything downstream renders "N/A" for the rest rather than
 * inventing a line.
 *
 * The benchmark list itself lives in the database (`public.benchmarks`), not in this file, so a
 * deployment whose provider does serve indices can add one without a code change.
 */
export type BenchmarkDefinition = {
  id: string
  code: string
  name: string
  /** The symbol this deployment's provider knows the index by. */
  symbol: string
  market: Market
  /** The currency the index is quoted in — often not the portfolio's. */
  currency: Currency
}

export interface BenchmarkProvider {
  readonly name: string
  /**
   * Whether this provider's plan can serve a given index. Empty is a valid, common answer, and the
   * reason `getSeries` is never called speculatively.
   */
  supports(benchmark: BenchmarkDefinition): Promise<boolean>
  /**
   * Daily closes over the range. **Resolves to `[]` rather than throwing** when the index is not
   * available: a benchmark is a comparison, and failing to fetch one must cost the comparison, not
   * the page it sits on.
   */
  getSeries(benchmark: BenchmarkDefinition, range: Range): Promise<Candle[]>
}

/**
 * Rebases a benchmark onto the portfolio's starting value, so both lines begin at the same point
 * and the comparison is about rate of change rather than absolute level.
 */
export function rebase(
  series: readonly Candle[],
  startValue: number,
): Array<{ date: string; value: number }> {
  const first = series[0]?.close
  if (!first || startValue <= 0) return []
  return series.map((candle) => ({ date: candle.date, value: (candle.close / first) * startValue }))
}
