import { enforceRateLimit, fail, guarded, ok } from "@/lib/api"
import { isValidSymbol, normalizeSymbol, toMarket } from "@/lib/symbol"
import { getMarketDataProvider } from "@/services/market-data"

type Ctx = { params: Promise<{ symbol: string }> }

/** Polled by the client for a live price. The upstream response is cached for 60s. */
export async function GET(request: Request, { params }: Ctx) {
  return guarded(async (userId) => {
    // The client polls one symbol a minute while the market is open, so this leaves room for a
    // handful of open tabs and stops a loop. Responses are cached upstream for 60s regardless.
    enforceRateLimit(`stocks:quote:${userId}`, 60, 60)

    const { symbol: raw } = await params
    if (!isValidSymbol(raw)) return fail("VALIDATION_ERROR", "That is not a valid symbol.")

    const market = toMarket(new URL(request.url).searchParams.get("market"))
    const quote = await getMarketDataProvider().getQuote(normalizeSymbol(raw), market)

    return quote ? ok({ quote }) : fail("NOT_FOUND", "No market data for that symbol.")
  })
}
