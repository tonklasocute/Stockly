import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { canSell } from "@/domain/holdings"
import { listTransactions, listTransactionsPage, toDomain } from "@/features/transactions/queries"
import { transactionInputSchema } from "@/features/transactions/schema"
import { invalidatePortfolio } from "@/lib/cache"
import { toPage } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"

/**
 * One page of transactions. Paginated because a transaction history grows without bound and an
 * endpoint that returns all of it eventually returns megabytes.
 *
 * The calculation engine deliberately does not use this: holdings and P&L are computed from every
 * row, and a portfolio derived from one page would be wrong.
 */
export async function GET(request: Request) {
  return guarded(async () => {
    const url = new URL(request.url)
    const portfolioId = url.searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "portfolioId is required.")

    const page = await listTransactionsPage(portfolioId, toPage(url.searchParams.get("page")))
    return ok({ transactions: page.rows, meta: page })
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
        market: body.market,
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
        market: body.market,
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

    invalidatePortfolio()
    return ok(data, 201)
  })
}
