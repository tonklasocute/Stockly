import { ApiError, guarded, ok } from "@/lib/api"
import { auditFor, auditForPortfolio } from "@/features/operations/queries"
import { toPage } from "@/lib/pagination"

/**
 * The audit trail, read-only.
 *
 * There is no POST here and there never will be: `financial_audit` is written by a database trigger
 * and has no insert, update or delete policy, so an audit row cannot be created, altered or removed
 * through a request. RLS scopes every read to its owner.
 */
export async function GET(request: Request) {
  return guarded(async () => {
    const params = new URL(request.url).searchParams
    const entityId = params.get("entityId")
    const portfolioId = params.get("portfolioId")

    if (entityId) return ok({ events: await auditFor(entityId) })
    if (portfolioId) return ok(await auditForPortfolio(portfolioId, toPage(params.get("page"))))
    throw new ApiError("VALIDATION_ERROR", "Pass entityId or portfolioId.", "entityOrPortfolioRequired")
  })
}
