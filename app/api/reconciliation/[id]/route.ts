import { fail, guarded, ok } from "@/lib/api"
import { invalidateReconciliation } from "@/lib/cache"
import { allItems, getRun } from "@/features/operations/queries"
import { summariseItems } from "@/features/operations/reconcile"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

/**
 * One run and its counts.
 *
 * The counts are recomputed from the stored items rather than read from the run's `summary`, so a
 * resolved finding is reflected immediately and the two can never disagree. RLS scopes both reads:
 * a run belonging to another user is simply not found.
 */
export async function GET(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const run = await getRun(id)
    if (!run) return fail("NOT_FOUND", "Reconciliation not found.")
    return ok({ run, summary: summariseItems(await allItems(id)) })
  })
}

/** Deleting a run deletes findings. It has never been able to delete money — no item is a row in
 * any financial table, and `reconciliation_items` references none. */
export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("reconciliation_runs")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Reconciliation not found.")
    invalidateReconciliation()
    return ok({ id: data.id })
  })
}
