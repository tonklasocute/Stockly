import { ApiError, fail, guarded, ok, parseBody } from "@/lib/api"
import { invalidateSimulations } from "@/lib/cache"
import { savedSimulationUpdateSchema } from "@/features/simulations/schema"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Rename a scenario, or replace its inputs.
 *
 * The type is immutable: the shape of `inputs` depends on it, and changing one without the other
 * would leave a document nothing could read back. Saving a different kind of scenario means saving
 * a new one.
 *
 * RLS is what makes an id from another user safe — the update matches zero rows and returns 404,
 * which is also the right answer, since the caller has no way to tell a row they cannot see from
 * one that does not exist.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const body = await parseBody(request, savedSimulationUpdateSchema)
    const { id } = await params
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("saved_simulations")
      .update({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.inputs !== undefined ? { inputs: body.inputs } : {}),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error?.code === "23505") {
      throw new ApiError("CONFLICT", "You already have a scenario with that name.", "duplicateScenarioName")
    }
    if (error?.code === "23514") {
      throw new ApiError("VALIDATION_ERROR", "That change violates a data rule.", "dataRuleChange")
    }
    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Scenario not found.")

    invalidateSimulations()
    return ok(data)
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("saved_simulations")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Scenario not found.")
    invalidateSimulations()
    return ok({ id: data.id })
  })
}
