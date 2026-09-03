import { enforceRateLimit, guarded, ok } from "@/lib/api"
import { loadPortfolioEvents } from "@/features/fundamentals/events-loader"

/**
 * Upcoming corporate events for the instruments the caller holds or watches.
 *
 * The events themselves are public reference data; **which instruments this user holds is not**,
 * and that join happens on the server under the caller's own session. The response carries a
 * `relation` of HELD or WATCHED and no quantity, value or cost — enough to explain why a row is
 * there, and nothing about the size of the position behind it.
 *
 * `portfolioId` is read through RLS, so an id belonging to somebody else contributes no holdings
 * rather than somebody else's.
 */
export async function GET(request: Request) {
  return guarded(async (userId) => {
    // Each call can reach the provider once per instrument, bounded by MAX_EVENT_INSTRUMENTS.
    enforceRateLimit(`events:${userId}`, 20, 60)
    const portfolioId = new URL(request.url).searchParams.get("portfolioId")
    return ok(await loadPortfolioEvents(portfolioId))
  })
}
