import { guarded, ok, parseBody } from "@/lib/api"
import { invalidatePortfolio } from "@/lib/cache"
import { listDividendsPage } from "@/features/dividends/queries"
import { dividendInputSchema } from "@/features/dividends/schema"
import { toPage } from "@/lib/pagination"
import { notifyDividendRecorded } from "@/features/alerts/dividend-hook"
import { currencyOf } from "@/domain/market"
import { createClient } from "@/lib/supabase/server"
import { ApiError } from "@/lib/api"

export async function GET(request: Request) {
  return guarded(async () => {
    const url = new URL(request.url)
    const portfolioId = url.searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "portfolioId is required.")
    return ok(await listDividendsPage(portfolioId, toPage(url.searchParams.get("page"))))
  })
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, dividendInputSchema)
    const currency = body.currency ?? currencyOf(body.market)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("dividends")
      .insert({
        portfolio_id: body.portfolioId,
        user_id: userId, // from the session, never the body
        symbol: body.symbol,
        market: body.market,
        payment_date: body.paymentDate,
        shares: body.shares,
        dividend_per_share: body.dividendPerShare,
        tax: body.tax,
        fee: body.fee,
        // A payment currency can differ from the venue's, so it is stored; when the user does not
        // say otherwise it is the market's, which is right for the overwhelming majority of rows.
        currency,
        notes: body.notes || null,
      })
      .select("*")
      .single()

    if (error?.code === "23514") {
      throw new ApiError("VALIDATION_ERROR", "That dividend violates a data rule.")
    }
    if (error) throw error

    // A dividend moves cash, dividend analytics and the portfolio summary together.
    invalidatePortfolio()

    // Raised from the write rather than polled: the event is this row existing.
    await notifyDividendRecorded(supabase, userId, {
      symbol: body.symbol,
      netAmount: body.shares * body.dividendPerShare - body.tax - body.fee,
      currency,
    })

    return ok(data, 201)
  })
}
