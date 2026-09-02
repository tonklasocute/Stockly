import { enforceRateLimit, fail, guarded, ok } from "@/lib/api"
import { analyze } from "@/domain/technical"
import { readSnapshots, SNAPSHOT_STALE_MINUTES } from "@/features/technical/snapshots"
import { currencyOf, isValidSymbol, normalizeSymbol, symbolKey, toMarket } from "@/domain/market"
import { getMarketDataProvider } from "@/services/market-data"

type Ctx = { params: Promise<{ symbol: string }> }

/**
 * A stock's technical snapshot.
 *
 * Served from the cache when it is fresh; computed on demand otherwise, because a user who opened
 * this page specifically wants this stock and one OHLCV request is a fair price for that. The
 * screener, which would need hundreds, never takes this path.
 */
export async function GET(request: Request, { params }: Ctx) {
  return guarded(async (userId) => {
    // A cache miss here costs a full OHLCV request, and the free tier allows eight a minute across
    // the whole deployment — so this is the tightest market-data limit in the app.
    enforceRateLimit(`stocks:technical:${userId}`, 20, 60)

    const { symbol: raw } = await params
    const market = toMarket(new URL(request.url).searchParams.get("market"))
    if (!isValidSymbol(raw, market)) return fail("VALIDATION_ERROR", "That is not a valid symbol.")
    const symbol = normalizeSymbol(raw)

    const cached = (await readSnapshots([{ symbol, market }])).get(symbolKey(symbol, market))
    if (cached && !cached.stale) {
      return ok({
        snapshot: cached.snapshot,
        calculatedAt: cached.calculatedAt,
        stale: false,
        source: "cache" as const,
        market,
        // Indicators are computed from the instrument's native price series, so every price in the
        // snapshot is in this currency — never the portfolio's.
        currency: currencyOf(market),
      })
    }

    const candles = await getMarketDataProvider(market).getHistoricalPrices(symbol, "1Y", market)
    if (candles.length === 0) {
      // Fall back to a stale snapshot rather than nothing — labelled, so it is never mistaken
      // for a current reading.
      return cached
        ? ok({
            snapshot: cached.snapshot,
            calculatedAt: cached.calculatedAt,
            stale: true,
            source: "cache" as const,
            market,
            currency: currencyOf(market),
          })
        : fail("NOT_FOUND", "No price history for that symbol.")
    }

    return ok({
      snapshot: analyze(symbol, candles),
      calculatedAt: new Date().toISOString(),
      stale: false,
      source: "computed" as const,
      market,
      currency: currencyOf(market),
      staleAfterMinutes: SNAPSHOT_STALE_MINUTES,
    })
  })
}
