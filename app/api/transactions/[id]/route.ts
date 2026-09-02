import { ApiError, fail, guarded, ok, parseBody } from "@/lib/api"
import { canSell } from "@/domain/holdings"
import { listTransactions, toDomain } from "@/features/transactions/queries"
import { transactionUpdateSchema } from "@/features/transactions/schema"
import { invalidatePortfolio } from "@/lib/cache"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const body = await parseBody(request, transactionUpdateSchema)
    const { id } = await params
    const supabase = await createClient()

    const { data: current, error: readError } = await supabase
      .from("transactions")
      .select("id, portfolio_id, market, created_at")
      .eq("id", id)
      .maybeSingle()

    if (readError) throw readError
    if (!current) return fail("NOT_FOUND", "Transaction not found.")

    if (body.side === "sell") {
      // Re-check against every other transaction, with this row's previous version removed —
      // an edit can otherwise turn a valid history into an oversold position.
      const others = toDomain(
        (await listTransactions(current.portfolio_id)).filter((t) => t.id !== id),
      )
      const check = canSell(others, {
        symbol: body.symbol,
        market: body.market,
        side: "sell",
        tradeDate: body.tradeDate,
        quantity: body.quantity,
        price: body.price,
        fee: body.fee,
        sequence: Date.parse(current.created_at),
      })
      if (!check.ok) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `You only hold ${check.available} ${body.symbol} on ${body.tradeDate}.`,
        )
      }
    }

    const { data, error } = await supabase
      .from("transactions")
      .update({
        symbol: body.symbol,
        market: body.market,
        side: body.side,
        trade_date: body.tradeDate,
        quantity: body.quantity,
        price: body.price,
        fee: body.fee,
        notes: body.notes || null,
      })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error) throw error
    if (data) invalidatePortfolio()
    return data ? ok(data) : fail("NOT_FOUND", "Transaction not found.")
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("transactions")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (data) invalidatePortfolio()
    return data ? ok({ id: data.id }) : fail("NOT_FOUND", "Transaction not found.")
  })
}
