import { ApiError, fail, guarded, ok, parseBody } from "@/lib/api"
import { invalidateIntelligence } from "@/lib/cache"
import { thesisUpdateSchema } from "@/features/theses/schema"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

/**
 * An edit cannot move a thesis to another instrument — the schema omits those fields — so the only
 * way to change what a thesis is about is to write a new one, which keeps the old reasoning intact.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const body = await parseBody(request, thesisUpdateSchema)
    const { id } = await params
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("investment_theses")
      .update({
        title: body.title,
        why_bought: body.whyBought,
        expectations: body.expectations,
        catalysts: body.catalysts,
        risks: body.risks,
        invalidation_criteria: body.invalidationCriteria,
        conviction: body.conviction,
        status: body.status,
      })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error?.code === "23505") {
      throw new ApiError("CONFLICT", "Another open thesis already covers that instrument.", "duplicateThesis")
    }
    if (error?.code === "23514") {
      throw new ApiError("VALIDATION_ERROR", "That thesis violates a data rule.", "dataRuleThesis")
    }
    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Thesis not found.")

    invalidateIntelligence()
    return ok(data)
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("investment_theses")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Thesis not found.")
    invalidateIntelligence()
    return ok({ id: data.id })
  })
}
