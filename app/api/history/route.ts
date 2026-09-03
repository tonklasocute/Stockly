import { HISTORY_PERIODS, type HistoryPeriod } from "@/domain/history"
import { ApiError, guarded, ok } from "@/lib/api"
import { loadHistory } from "@/features/history/loader"

/**
 * Historical performance and attribution, as **one** endpoint.
 *
 * The obvious design is six — `/history`, `/attribution`, `/contributors`, `/drawdowns`,
 * `/monthly-performance`, `/allocation-history` — and it would be six reads of the same two things,
 * because every one of those answers is derived from the same transaction set and the same snapshot
 * series. One loader, one pass, one response, and a client that needs a slice takes a slice.
 *
 * Everything it returns is **derived on read**. There is no stored return, no stored contribution
 * and no stored drawdown, so correcting a transaction corrects the history rather than leaving a
 * stale reading behind.
 *
 * Ownership is RLS's: `loadHistory` reads through the request-scoped client, so a portfolio id
 * belonging to somebody else returns nothing rather than somebody else's history.
 */
export async function GET(request: Request) {
  return guarded(async () => {
    const params = new URL(request.url).searchParams
    const portfolioId = params.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "A portfolio is required.")

    // Validated server-side against a closed enum, never interpolated into a query.
    const requested = params.get("period") ?? "1Y"
    if (!HISTORY_PERIODS.includes(requested as HistoryPeriod)) {
      throw new ApiError("VALIDATION_ERROR", "That period is not one Stockly offers.")
    }

    return ok(await loadHistory(portfolioId, requested as HistoryPeriod))
  })
}
