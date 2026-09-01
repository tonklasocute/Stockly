import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { portfolioInputSchema } from "@/features/portfolios/schema"
import { listPortfolios } from "@/features/portfolios/queries"
import { invalidatePortfolio } from "@/lib/cache"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  return guarded(async () => ok({ portfolios: await listPortfolios() }))
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, portfolioInputSchema)
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("portfolios")
      // user_id comes from the session, never from the request body.
      .insert({ user_id: userId, name: body.name, currency: body.currency })
      .select("*")
      .single()

    if (error?.code === "23505") {
      throw new ApiError("CONFLICT", "You already have a portfolio with that name.")
    }
    if (error) throw error

    invalidatePortfolio()
    return ok(data, 201)
  })
}
