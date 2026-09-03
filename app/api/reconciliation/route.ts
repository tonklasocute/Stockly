import { ApiError, enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { invalidateReconciliation } from "@/lib/cache"
import { listRuns } from "@/features/operations/queries"
import { runReconciliation } from "@/features/operations/reconcile"
import { reconciliationRequestSchema } from "@/features/operations/schema"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "portfolioId is required.", "portfolioRequired")
    return ok({ runs: await listRuns(portfolioId) })
  })
}

/**
 * Runs a comparison.
 *
 * It writes a run and its findings and **nothing else**. No transaction, no cash movement, no
 * holding — a difference becomes a change only when the user approves one, through the ordinary
 * endpoints that have always created those rows.
 *
 * Rate-limited because a run reads the full analytics pass, which prices the portfolio. A loop over
 * this endpoint would be a loop over the market-data provider.
 */
export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, reconciliationRequestSchema)
    enforceRateLimit(`reconcile:${userId}`, 10, 60)

    const supabase = await createClient()
    const result = await runReconciliation(supabase, body, userId)

    invalidateReconciliation()
    return ok(result, 201)
  })
}
