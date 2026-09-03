import { fail, guarded, ok, parseBody } from "@/lib/api"
import { invalidateReconciliation } from "@/lib/cache"
import { listItems } from "@/features/operations/queries"
import { resolveItemSchema } from "@/features/operations/schema"
import { toPage } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

/** Paginated: a statement of five hundred positions is five hundred findings. */
export async function GET(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const page = toPage(new URL(request.url).searchParams.get("page"))
    return ok(await listItems(id, page))
  })
}

/**
 * Marks a finding as dealt with.
 *
 * **This records a decision; it does not act on one.** Marking an item `ADJUSTED` does not create
 * an adjustment — the user creates that as an ordinary transaction, and this says they did. A
 * resolved item is kept rather than deleted: the record that a difference existed is the point.
 */
export async function PATCH(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id: runId } = await params
    const body = await parseBody(request, resolveItemSchema)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("reconciliation_items")
      .update({ resolution: body.resolution, resolved_at: new Date().toISOString() })
      // Scoped to the run in the path as well as to the item, so an id from another run cannot be
      // resolved through this one. RLS scopes both to the user on top of that.
      .eq("id", body.itemId)
      .eq("run_id", runId)
      .select("*")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Finding not found.")
    invalidateReconciliation()
    return ok(data)
  })
}
