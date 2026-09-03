import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePersonalization } from "@/lib/cache"
import { savedViewSchema } from "@/features/personalization/schema"
import { createClient } from "@/lib/supabase/server"

/**
 * Ownership is RLS's. An id belonging to another user matches no row, so the update or delete
 * affects nothing and the caller receives a **404** — never a 403, which would confirm the id
 * exists.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await context.params
    const body = await parseBody(request, savedViewSchema)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("saved_views")
      .update({ name: body.name, config: body.config, portfolio_id: body.portfolioId })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error?.code === "23505") throw new ApiError("CONFLICT", "You already have a view with that name.", "duplicateViewName")
    if (error) throw error
    if (!data) throw new ApiError("NOT_FOUND", "That view does not exist.", "viewMissing")

    invalidatePersonalization()
    return ok(data)
  })
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await context.params
    const supabase = await createClient()

    // Deleting a view deletes a filter. No transaction, holding or P&L figure is reachable from it.
    const { data, error } = await supabase.from("saved_views").delete().eq("id", id).select("id").maybeSingle()
    if (error) throw error
    if (!data) throw new ApiError("NOT_FOUND", "That view does not exist.", "viewMissing")

    invalidatePersonalization()
    return ok({ deleted: true })
  })
}
