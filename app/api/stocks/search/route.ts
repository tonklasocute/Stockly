import { enforceRateLimit, guarded, ok } from "@/lib/api"
import { getMarketDataProvider } from "@/services/market-data"

/** Typeahead for the global stock search. Debounced on the client; cached for a day upstream. */
export async function GET(request: Request) {
  return guarded(async (userId) => {
    // Every search that gets past the client's debounce is one upstream credit. The debounce is a
    // UX affordance, not a control: a script calling this endpoint directly ignores it entirely.
    enforceRateLimit(`stocks:search:${userId}`, 30, 60)

    const query = new URL(request.url).searchParams.get("q")?.trim() ?? ""
    // Two characters is the shortest query worth a credit.
    if (query.length < 2) return ok({ results: [] })

    return ok({ results: await getMarketDataProvider().searchSymbols(query.slice(0, 40)) })
  })
}
