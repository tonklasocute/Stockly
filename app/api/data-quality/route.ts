import { ApiError, guarded, ok } from "@/lib/api"
import { loadDataQuality } from "@/features/data-quality/loader"

/**
 * The data-quality scan.
 *
 * **A read.** There is no `POST /scan` because there is nothing to trigger: an issue is a pure
 * function of the portfolio's current state, computed on request from the same cached pass the
 * dashboard uses. A stored issue list would be a cache that goes quietly wrong — an issue still
 * listed after the thing that caused it was fixed is worse than no list at all.
 */
export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "portfolioId is required.", "portfolioRequired")
    return ok(await loadDataQuality(portfolioId))
  })
}
