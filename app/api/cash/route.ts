import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePortfolio } from "@/lib/cache"
import { listCashPage } from "@/features/cash/queries"
import { cashInputSchema } from "@/features/cash/schema"
import { toPage } from "@/lib/pagination"
import { baseCurrencyOf } from "@/domain/market"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  return guarded(async () => {
    const url = new URL(request.url)
    const portfolioId = url.searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "portfolioId is required.", "portfolioRequired")
    return ok(await listCashPage(portfolioId, toPage(url.searchParams.get("page"))))
  })
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, cashInputSchema)
    const supabase = await createClient()

    // Defaults to the portfolio's base currency, which is what a deposit almost always is. RLS
    // scopes the lookup, so a portfolio that is not the caller's simply is not found and the
    // insert below fails on the ownership constraint rather than here.
    const { data: portfolio } = await supabase
      .from("portfolios")
      .select("currency")
      .eq("id", body.portfolioId)
      .maybeSingle()
    const currency = body.currency ?? baseCurrencyOf(portfolio?.currency)

    const { data, error } = await supabase
      .from("cash_transactions")
      .insert({
        portfolio_id: body.portfolioId,
        user_id: userId,
        kind: body.kind,
        amount: body.amount,
        currency,
        occurred_on: body.occurredOn,
        notes: body.notes || null,
      })
      .select("*")
      .single()

    if (error?.code === "23514") {
      throw new ApiError("VALIDATION_ERROR", "That cash movement violates a data rule.", "dataRuleCash")
    }
    if (error) throw error

    invalidatePortfolio()
    return ok(data, 201)
  })
}
