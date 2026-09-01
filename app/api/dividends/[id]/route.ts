import { fail, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePortfolio } from "@/lib/cache"
import { dividendUpdateSchema } from "@/features/dividends/schema"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const body = await parseBody(request, dividendUpdateSchema)
    const { id } = await params
    const supabase = await createClient()

    // RLS scopes this to the caller: another user's id updates zero rows and 404s.
    const { data, error } = await supabase
      .from("dividends")
      .update({
        symbol: body.symbol,
        payment_date: body.paymentDate,
        shares: body.shares,
        dividend_per_share: body.dividendPerShare,
        tax: body.tax,
        fee: body.fee,
        notes: body.notes || null,
      })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Dividend not found.")
    invalidatePortfolio()
    return ok(data)
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("dividends")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Dividend not found.")
    invalidatePortfolio()
    return ok({ id: data.id })
  })
}
