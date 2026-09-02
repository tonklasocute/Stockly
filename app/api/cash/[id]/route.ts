import { fail, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePortfolio } from "@/lib/cache"
import { cashUpdateSchema } from "@/features/cash/schema"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const body = await parseBody(request, cashUpdateSchema)
    const { id } = await params
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("cash_transactions")
      .update({
        kind: body.kind,
        amount: body.amount,
        // Omitted when the form did not send one, so an edit never silently redenominates a
        // balance that was recorded in a different currency.
        ...(body.currency ? { currency: body.currency } : {}),
        occurred_on: body.occurredOn,
        notes: body.notes || null,
      })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Cash transaction not found.")
    invalidatePortfolio()
    return ok(data)
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("cash_transactions")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Cash transaction not found.")
    invalidatePortfolio()
    return ok({ id: data.id })
  })
}
