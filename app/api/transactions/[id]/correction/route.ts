import { ApiError, fail, guarded, ok, parseBody } from "@/lib/api"
import { canSell } from "@/domain/holdings"
import { correctionSchema } from "@/features/operations/schema"
import { listTransactions, toDomain } from "@/features/transactions/queries"
import { invalidatePortfolio } from "@/lib/cache"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

/**
 * Correcting a transaction, with the reason recorded.
 *
 * The difference from `PATCH /api/transactions/:id` is one field and one guarantee. Both write an
 * audit row — the trigger sees to that, and no route can opt out — but PostgREST sends each request
 * as its own transaction, so a reason set by a separate call would never reach the trigger. The
 * `correct_transaction` function performs the update itself, which is what puts the reason and the
 * change in the same transaction.
 *
 * The function is `security definer`, so RLS does not apply inside it and its `user_id = auth.uid()`
 * predicate is the ownership check. The sell-coverage check below runs first, for the same reason
 * it runs on a plain edit: a correction can otherwise turn a valid history into an oversold one.
 */
export async function POST(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const body = await parseBody(request, correctionSchema)
    const supabase = await createClient()

    const { data: current, error: readError } = await supabase
      .from("transactions")
      .select("id, portfolio_id, created_at")
      .eq("id", id)
      .maybeSingle()

    if (readError) throw readError
    if (!current) return fail("NOT_FOUND", "Transaction not found.")

    if (body.side === "sell") {
      // Re-checked with this row's previous version removed, exactly as the plain edit does.
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

    const { data, error } = await supabase.rpc("correct_transaction", {
      p_id: id,
      p_symbol: body.symbol,
      p_market: body.market,
      p_side: body.side,
      p_trade_date: body.tradeDate,
      p_quantity: body.quantity,
      p_price: body.price,
      p_fee: body.fee,
      p_notes: body.notes,
      p_reason: body.reason,
    })

    // P0002 is the function's own "not found", which covers a row belonging to somebody else.
    if (error?.code === "P0002") return fail("NOT_FOUND", "Transaction not found.")
    if (error?.code === "22023") throw new ApiError("VALIDATION_ERROR", "A correction must state a reason.")
    if (error) throw error

    invalidatePortfolio()
    return ok(data)
  })
}
