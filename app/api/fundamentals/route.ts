import { isValidSymbol, normalizeSymbol, toMarket } from "@/domain/market"
import { ApiError, enforceRateLimit, guarded, ok } from "@/lib/api"
import { loadFundamentals } from "@/features/fundamentals/loader"

/**
 * Company fundamentals for one instrument.
 *
 * Authenticated, because fundamental data costs a provider request and an unauthenticated endpoint
 * that spends money is an endpoint somebody will spend for us. The *data* is public reference
 * information; the *ability to make Stockly fetch it* is not.
 *
 * No portfolio id is accepted. This route answers questions about a company, and it has no way to
 * be asked about a user.
 */
export async function GET(request: Request) {
  return guarded(async (userId) => {
    const params = new URL(request.url).searchParams
    const raw = params.get("symbol")
    if (!raw) throw new ApiError("VALIDATION_ERROR", "A symbol is required.", "symbolRequired")

    const market = toMarket(params.get("market") ?? undefined)
    if (!isValidSymbol(raw, market)) throw new ApiError("VALIDATION_ERROR", "That symbol is not valid.", "symbolInvalid")

    // A provider call per request, so this is the money brake rather than a loop brake.
    enforceRateLimit(`fundamentals:${userId}`, 30, 60)

    const price = Number(params.get("price"))
    return ok(
      await loadFundamentals(
        normalizeSymbol(raw),
        market,
        Number.isFinite(price) && price > 0 ? price : null,
      ),
    )
  })
}
