import { enforceRateLimit, guarded, ok } from "@/lib/api"
import { parseMarket } from "@/domain/market"
import { searchInstruments } from "@/services/market-data"

/** Typeahead for the global stock search. Debounced on the client; cached for a day upstream. */
export async function GET(request: Request) {
  return guarded(async (userId) => {
    // Every search that gets past the client's debounce is one upstream credit. The debounce is a
    // UX affordance, not a control: a script calling this endpoint directly ignores it entirely.
    enforceRateLimit(`stocks:search:${userId}`, 30, 60)

    const url = new URL(request.url)
    const query = url.searchParams.get("q")?.trim() ?? ""
    // Two characters is the shortest query worth a credit.
    if (query.length < 2) return ok({ results: [] })

    // No market means every market Stockly supports; a bad one means every market too, rather than
    // a silent fallback to US that would hide Thai results without saying so.
    const market = parseMarket(url.searchParams.get("market")) ?? undefined
    return ok({ results: await searchInstruments(query.slice(0, 40), market) })
  })
}
