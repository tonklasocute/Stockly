import { fail, guarded, ok, parseBody } from "@/lib/api"
import { invalidateIntelligence } from "@/lib/cache"
import { journalUpdateSchema } from "@/features/journal/schema"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

/**
 * RLS is what makes this safe against an id from another user: the update matches zero rows and
 * returns a 404, which is also the right answer — the caller has no way to tell a row they cannot
 * see from a row that does not exist, and should not.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const body = await parseBody(request, journalUpdateSchema)
    const { id } = await params
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("investment_journals")
      .update({
        ...(body.type ? { type: body.type } : {}),
        // Explicitly nullable: clearing a sell reason is a real edit, and `undefined` would mean
        // "leave it alone" rather than "remove it".
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.content !== undefined ? { content: body.content } : {}),
        ...(body.entryDate ? { entry_date: body.entryDate } : {}),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Journal entry not found.")
    invalidateIntelligence()
    return ok(data)
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("investment_journals")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Journal entry not found.")
    invalidateIntelligence()
    return ok({ id: data.id })
  })
}
