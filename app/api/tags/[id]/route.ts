import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePersonalization } from "@/lib/cache"
import { tagSchema } from "@/features/personalization/schema"
import { createClient } from "@/lib/supabase/server"

/**
 * Renaming and deleting a tag.
 *
 * Ownership is RLS's, not this handler's: an id belonging to somebody else matches no row, so the
 * update or delete affects nothing and the caller gets a **404**. Not a 403 — confirming that an id
 * exists is information they did not have.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await context.params
    const body = await parseBody(request, tagSchema)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("tags")
      .update({ name: body.name, color: body.color })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error?.code === "23505") throw new ApiError("CONFLICT", "You already have a tag with that name.")
    if (error) throw error
    if (!data) throw new ApiError("NOT_FOUND", "That tag does not exist.")

    invalidatePersonalization()
    return ok(data)
  })
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guarded(async () => {
    const { id } = await context.params
    const supabase = await createClient()

    // Assignments cascade with the tag. They are labels; nothing financial references them, so
    // deleting a tag removes a label from some positions and reaches nothing else.
    const { data, error } = await supabase.from("tags").delete().eq("id", id).select("id").maybeSingle()
    if (error) throw error
    if (!data) throw new ApiError("NOT_FOUND", "That tag does not exist.")

    invalidatePersonalization()
    return ok({ deleted: true })
  })
}
