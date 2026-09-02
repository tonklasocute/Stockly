import { enforceRateLimit, fail, guarded, ok } from "@/lib/api"
import { isValidSymbol, normalizeSymbol, toMarket } from "@/lib/symbol"
import { getMarketDataProvider, RANGES, type Range } from "@/services/market-data"

type Ctx = { params: Promise<{ symbol: string }> }

export async function GET(request: Request, { params }: Ctx) {
  return guarded(async (userId) => {
    // A range switch on the chart is one of these; a user cannot click faster than this allows.
    enforceRateLimit(`stocks:history:${userId}`, 30, 60)

    const { symbol: raw } = await params
    if (!isValidSymbol(raw)) return fail("VALIDATION_ERROR", "That is not a valid symbol.")

    const url = new URL(request.url)
    const requested = (url.searchParams.get("range") ?? "1M").toUpperCase()
    if (!RANGES.includes(requested as Range)) {
      return fail("VALIDATION_ERROR", `Range must be one of ${RANGES.join(", ")}.`)
    }

    const candles = await getMarketDataProvider().getHistoricalPrices(
      normalizeSymbol(raw),
      requested as Range,
      toMarket(url.searchParams.get("market")),
    )
    return ok({ candles, range: requested })
  })
}
