import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidateIntelligence } from "@/lib/cache"
import { listGoals } from "@/features/goals/queries"
import { goalInputSchema } from "@/features/goals/schema"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "portfolioId is required.", "portfolioRequired")
    // Rows only. Progress is derived from the calculation engine on the page that renders it, so
    // an endpoint returning a stored "progress" figure could never exist to go stale.
    return ok({ goals: await listGoals(portfolioId) })
  })
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, goalInputSchema)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("portfolio_goals")
      .insert({
        portfolio_id: body.portfolioId,
        user_id: userId, // from the session, never the body
        type: body.type,
        target_value: body.targetValue,
        // Null exactly for TOTAL_RETURN, which is a percentage. The database enforces the same rule.
        currency: body.currency ?? null,
        target_date: body.targetDate ?? null,
        note: body.note ?? null,
      })
      .select("*")
      .single()

    if (error?.code === "23505") {
      throw new ApiError("CONFLICT", "This portfolio already has a goal of that type.", "duplicateGoalType")
    }
    if (error?.code === "23514" || error?.code === "23503") {
      throw new ApiError("VALIDATION_ERROR", "That goal violates a data rule.", "dataRuleGoal")
    }
    if (error) throw error

    invalidateIntelligence()
    return ok(data, 201)
  })
}
