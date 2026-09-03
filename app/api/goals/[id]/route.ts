import { ApiError, fail, guarded, ok, parseBody } from "@/lib/api"
import { invalidateIntelligence } from "@/lib/cache"
import { goalUpdateSchema } from "@/features/goals/schema"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

/**
 * A goal's **type is immutable**: changing it would silently reinterpret the target — 100,000 as a
 * portfolio value and 100,000 as an annual dividend income are not the same goal — so the update
 * schema has no `type` field and the only way to change one is to delete it and set another.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const body = await parseBody(request, goalUpdateSchema)
    const { id } = await params
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("portfolio_goals")
      .update({
        ...(body.targetValue !== undefined ? { target_value: body.targetValue } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.targetDate !== undefined ? { target_date: body.targetDate } : {}),
        ...(body.note !== undefined ? { note: body.note } : {}),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error?.code === "23514") {
      // The currency rule is the likely one: a percentage target cannot carry a currency, and a
      // money target cannot be without one.
      throw new ApiError("VALIDATION_ERROR", "That change violates the goal's currency rule.", "goalCurrencyRule")
    }
    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Goal not found.")

    invalidateIntelligence()
    return ok(data)
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("portfolio_goals")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Goal not found.")
    invalidateIntelligence()
    return ok({ id: data.id })
  })
}
