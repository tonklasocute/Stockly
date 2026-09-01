import { guarded, ok } from "@/lib/api"
import { getMarketDataProvider } from "@/services/market-data"

/** Typeahead for the global stock search. Debounced on the client; cached for a day upstream. */
export async function GET(request: Request) {
  return guarded(async () => {
    const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""
    // Two characters is the shortest query worth a credit.
    if (query.length < 2) return ok({ results: [] })

    return ok({ results: await getMarketDataProvider().searchSymbols(query.slice(0, 40)) })
  })
}
