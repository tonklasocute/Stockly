import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidateIntelligence } from "@/lib/cache"
import { listTheses } from "@/features/theses/queries"
import { thesisInputSchema } from "@/features/theses/schema"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "portfolioId is required.")
    return ok({ theses: await listTheses(portfolioId) })
  })
}

/**
 * `status` is whatever the user sent. Nothing here derives it from the position's performance, and
 * nothing else in the codebase writes it either — a system that marked a thesis broken would be
 * making a sell recommendation with extra steps.
 */
export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, thesisInputSchema)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("investment_theses")
      .insert({
        portfolio_id: body.portfolioId,
        user_id: userId, // from the session, never the body
        symbol: body.symbol,
        market: body.market,
        title: body.title,
        why_bought: body.whyBought,
        expectations: body.expectations,
        catalysts: body.catalysts,
        risks: body.risks,
        invalidation_criteria: body.invalidationCriteria,
        conviction: body.conviction,
        status: body.status,
      })
      .select("*")
      .single()

    if (error?.code === "23505") {
      throw new ApiError(
        "CONFLICT",
        `There is already an open thesis for ${body.symbol}. Edit it, or close it and write a new one.`,
      )
    }
    if (error?.code === "23514" || error?.code === "23503") {
      throw new ApiError("VALIDATION_ERROR", "That thesis violates a data rule.")
    }
    if (error) throw error

    invalidateIntelligence()
    return ok(data, 201)
  })
}
