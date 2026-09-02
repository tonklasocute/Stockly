import { fail, guarded, ok } from "@/lib/api"
import { findImportSession, listImportRows } from "@/features/imports/queries"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

/**
 * One import, with the rows that needed attention and the transactions it created.
 *
 * RLS is what makes an id from another user safe: the read matches nothing and returns 404, which
 * is also the right answer — the caller has no way to tell a row they cannot see from one that does
 * not exist.
 */
export async function GET(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const session = await findImportSession(id)
    if (!session) return fail("NOT_FOUND", "Import not found.")

    const supabase = await createClient()
    const [rows, { data: created }] = await Promise.all([
      listImportRows(id),
      supabase
        .from("transactions")
        .select("id, symbol, market, side, trade_date, quantity, price, fee, source_row")
        .eq("import_session_id", id)
        .order("source_row", { ascending: true })
        .limit(500),
    ])

    return ok({ session, rows, created: created ?? [] })
  })
}

/**
 * Deletes the record of an import. **It does not delete the transactions it created.**
 *
 * Those are financial records, and an import is only how they arrived. The foreign key is
 * `on delete set null`, so removing this history entry leaves every transaction exactly where it
 * is, minus its provenance. Reversing an import means reviewing and deleting the transactions
 * themselves, which the transactions page already does one at a time and deliberately.
 */
export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("import_sessions")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Import not found.")
    return ok({ id: data.id })
  })
}
