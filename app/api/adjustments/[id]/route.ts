import { fail, guarded, ok } from "@/lib/api"
import { invalidatePortfolio, invalidateReconciliation } from "@/lib/cache"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Removes a split.
 *
 * Fully reversible, and that is the property the whole design exists to have: the transactions were
 * never rewritten, so deleting this row restores every figure to exactly what it was before the
 * adjustment was recorded. Nothing about the user's actual trades is lost.
 */
export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("share_adjustments")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Adjustment not found.")

    invalidatePortfolio()
    invalidateReconciliation()
    return ok({ id: data.id })
  })
}
