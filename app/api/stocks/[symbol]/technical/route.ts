import { fail, guarded, ok } from "@/lib/api"
import { analyze } from "@/domain/technical"
import { readSnapshots, SNAPSHOT_STALE_MINUTES } from "@/features/technical/snapshots"
import { isValidSymbol, normalizeSymbol } from "@/lib/symbol"
import { getMarketDataProvider } from "@/services/market-data"

type Ctx = { params: Promise<{ symbol: string }> }

/**
 * A stock's technical snapshot.
 *
 * Served from the cache when it is fresh; computed on demand otherwise, because a user who opened
 * this page specifically wants this stock and one OHLCV request is a fair price for that. The
 * screener, which would need hundreds, never takes this path.
 */
export async function GET(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { symbol: raw } = await params
    if (!isValidSymbol(raw)) return fail("VALIDATION_ERROR", "That is not a valid symbol.")
    const symbol = normalizeSymbol(raw)

    const cached = (await readSnapshots([symbol])).get(symbol)
    if (cached && !cached.stale) {
      return ok({
        snapshot: cached.snapshot,
        calculatedAt: cached.calculatedAt,
        stale: false,
        source: "cache" as const,
      })
    }

    const candles = await getMarketDataProvider().getHistoricalPrices(symbol, "1Y")
    if (candles.length === 0) {
      // Fall back to a stale snapshot rather than nothing — labelled, so it is never mistaken
      // for a current reading.
      return cached
        ? ok({ snapshot: cached.snapshot, calculatedAt: cached.calculatedAt, stale: true, source: "cache" as const })
        : fail("NOT_FOUND", "No price history for that symbol.")
    }

    return ok({
      snapshot: analyze(symbol, candles),
      calculatedAt: new Date().toISOString(),
      stale: false,
      source: "computed" as const,
      staleAfterMinutes: SNAPSHOT_STALE_MINUTES,
    })
  })
}
