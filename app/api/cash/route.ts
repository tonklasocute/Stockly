import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePortfolio } from "@/lib/cache"
import { listCashPage } from "@/features/cash/queries"
import { cashInputSchema } from "@/features/cash/schema"
import { toPage } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"

export async function GET(request: Request) {
  return guarded(async () => {
    const url = new URL(request.url)
    const portfolioId = url.searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "portfolioId is required.")
    return ok(await listCashPage(portfolioId, toPage(url.searchParams.get("page"))))
  })
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, cashInputSchema)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("cash_transactions")
      .insert({
        portfolio_id: body.portfolioId,
        user_id: userId,
        kind: body.kind,
        amount: body.amount,
        currency: "USD",
        occurred_on: body.occurredOn,
        notes: body.notes || null,
      })
      .select("*")
      .single()

    if (error?.code === "23514") {
      throw new ApiError("VALIDATION_ERROR", "That cash movement violates a data rule.")
    }
    if (error) throw error

    invalidatePortfolio()
    return ok(data, 201)
  })
}
