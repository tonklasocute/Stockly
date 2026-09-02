import { logger } from "@/lib/log"
import { getMarketDataProvider, isMarketDataError } from "@/services/market-data"
import type { Candle, Range } from "@/services/market-data/types"
import type { BenchmarkDefinition, BenchmarkProvider } from "./types"

/**
 * Index series from the configured market-data provider.
 *
 * There is no separate HTTP client here on purpose: an index is a symbol like any other to Twelve
 * Data, so this goes through `getHistoricalPrices` and inherits the timeout, the retry, the Next
 * Data Cache and the rule that the API key is never logged. Adding a second fetcher for the same
 * endpoint would be a second place to get all of that wrong.
 *
 * **Index data is not on Twelve Data's free tier.** `supports` answers by trying once and caching
 * the answer for the process, so a deployment that cannot fetch indices asks once rather than on
 * every page render — and everything downstream shows "N/A" rather than an empty chart.
 */
const supportCache = new Map<string, boolean>()

export function createMarketDataBenchmarkProvider(): BenchmarkProvider {
  async function fetchSeries(
    benchmark: BenchmarkDefinition,
    range: Range,
  ): Promise<Candle[]> {
    try {
      const candles = await getMarketDataProvider(benchmark.market).getHistoricalPrices(
        benchmark.symbol,
        range,
        benchmark.market,
      )
      supportCache.set(benchmark.code, candles.length > 0)
      return candles
    } catch (error) {
      // A benchmark is a comparison. Losing it costs the comparison, never the page.
      logger.warn("benchmark.series_unavailable", {
        code: benchmark.code,
        reason: isMarketDataError(error) ? error.code : "UNKNOWN",
      })
      supportCache.set(benchmark.code, false)
      return []
    }
  }

  return {
    name: "market-data",

    async supports(benchmark) {
      const cached = supportCache.get(benchmark.code)
      if (cached !== undefined) return cached
      // One short probe rather than a full year: enough to learn whether the plan serves it at all.
      return (await fetchSeries(benchmark, "1M")).length > 0
    },

    getSeries: fetchSeries,
  }
}
