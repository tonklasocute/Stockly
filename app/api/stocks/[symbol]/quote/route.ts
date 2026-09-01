import { fail, guarded, ok } from "@/lib/api"
import { isValidSymbol, normalizeSymbol, toMarket } from "@/lib/symbol"
import { getMarketDataProvider } from "@/services/market-data"

type Ctx = { params: Promise<{ symbol: string }> }

/** Polled by the client for a live price. The upstream response is cached for 60s. */
export async function GET(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { symbol: raw } = await params
    if (!isValidSymbol(raw)) return fail("VALIDATION_ERROR", "That is not a valid symbol.")

    const market = toMarket(new URL(request.url).searchParams.get("market"))
    const quote = await getMarketDataProvider().getQuote(normalizeSymbol(raw), market)

    return quote ? ok({ quote }) : fail("NOT_FOUND", "No market data for that symbol.")
  })
}
