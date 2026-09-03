import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePortfolio, invalidateReconciliation } from "@/lib/cache"
import { listShareAdjustments } from "@/features/operations/queries"
import { shareAdjustmentSchema } from "@/features/operations/schema"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "portfolioId is required.", "portfolioRequired")
    return ok({ adjustments: await listShareAdjustments(portfolioId) })
  })
}

/**
 * Records a split.
 *
 * This is the one endpoint in phase 19 that changes a derived figure, and it does so without
 * touching a transaction: the row it writes is applied in front of the replay engine by
 * `domain/corporate-actions.ts`. Deleting it restores every number exactly, which is why the shape
 * was chosen over rewriting history or synthesising a trade.
 *
 * It is reached only from a preview the user confirmed. Nothing applies one automatically, and no
 * scheduled job writes here.
 */
export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, shareAdjustmentSchema)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("share_adjustments")
      .insert({
        portfolio_id: body.portfolioId,
        user_id: userId, // from the session, never the body
        symbol: body.symbol,
        market: body.market,
        // Derived from the ratio rather than accepted from the client: the two must agree, and
        // only one of them can be the source of that agreement.
        event_type: body.numerator > body.denominator ? "SPLIT" : "REVERSE_SPLIT",
        effective_date: body.effectiveDate,
        numerator: body.numerator,
        denominator: body.denominator,
        corporate_event_id: body.corporateEventId,
        note: body.note ?? null,
      })
      .select("*")
      .single()

    if (error?.code === "23505") {
      throw new ApiError(
        "CONFLICT",
        "That split is already recorded for this holding. Applying it twice would square the ratio.",
      )
    }
    if (error?.code === "23514" || error?.code === "23503") {
      throw new ApiError("VALIDATION_ERROR", "That adjustment violates a data rule.", "dataRuleAdjustment")
    }
    if (error) throw error

    // A split changes the share count every page derives, so the portfolio routes go with it.
    invalidatePortfolio()
    invalidateReconciliation()
    return ok(data, 201)
  })
}
