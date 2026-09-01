import { fail, guarded, ok } from "@/lib/api"
import { loadConversation } from "@/features/ai/queries"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const found = await loadConversation(id)
    // Another user's conversation is not found rather than forbidden: a 403 would confirm that the
    // id exists.
    if (!found) return fail("NOT_FOUND", "That conversation no longer exists.")
    return ok(found)
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    // RLS is the authorization: a delete against someone else's row matches nothing.
    const { error, count } = await supabase
      .from("ai_conversations")
      .delete({ count: "exact" })
      .eq("id", id)

    if (error) throw error
    if ((count ?? 0) === 0) return fail("NOT_FOUND", "That conversation no longer exists.")
    return ok({ id })
  })
}
