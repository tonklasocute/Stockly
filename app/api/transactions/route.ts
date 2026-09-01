import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { canSell } from "@/domain/holdings"
import { listTransactions, toDomain } from "@/features/transactions/queries"
import { transactionInputSchema } from "@/features/transactions/schema"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "portfolioId is required.")
    return ok({ transactions: await listTransactions(portfolioId) })
  })
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, transactionInputSchema)

    if (body.side === "sell") {
      // Recomputed server-side from stored rows; the client's view of the position is not trusted.
      const existing = toDomain(await listTransactions(body.portfolioId))
      const check = canSell(existing, {
        symbol: body.symbol,
        side: "sell",
        tradeDate: body.tradeDate,
        quantity: body.quantity,
        price: body.price,
        fee: body.fee,
        sequence: Date.now(),
      })
      if (!check.ok) {
        throw new ApiError(
          "VALIDATION_ERROR",
          `You only hold ${check.available} ${body.symbol} on ${body.tradeDate}.`,
        )
      }
    }

    const supabase = await createClient()
    const { data, error } = await supabase
      .from("transactions")
      .insert({
        portfolio_id: body.portfolioId,
        user_id: userId, // from the session, never the body
        symbol: body.symbol,
        market: "US",
        side: body.side,
        trade_date: body.tradeDate,
        quantity: body.quantity,
        price: body.price,
        fee: body.fee,
        notes: body.notes || null,
      })
      .select("*")
      .single()

    if (error?.code === "23514") {
      throw new ApiError("VALIDATION_ERROR", "That transaction violates a data rule.")
    }
    if (error) throw error
    return ok(data, 201)
  })
}
