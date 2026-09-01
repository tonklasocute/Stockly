import { ApiError, fail, guarded, ok, parseBody } from "@/lib/api"
import { portfolioInputSchema } from "@/features/portfolios/schema"
import { invalidatePortfolio } from "@/lib/cache"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const body = await parseBody(request, portfolioInputSchema)
    const { id } = await params
    const supabase = await createClient()

    // RLS scopes this to the caller: someone else's id updates zero rows and 404s.
    const { data, error } = await supabase
      .from("portfolios")
      .update({ name: body.name, currency: body.currency })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error?.code === "23505") {
      throw new ApiError("CONFLICT", "You already have a portfolio with that name.")
    }
    if (error) throw error
    if (data) invalidatePortfolio()
    return data ? ok(data) : fail("NOT_FOUND", "Portfolio not found.")
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    // Transactions go with it via `on delete cascade`.
    const { data, error } = await supabase
      .from("portfolios")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (data) invalidatePortfolio()
    return data ? ok({ id: data.id }) : fail("NOT_FOUND", "Portfolio not found.")
  })
}
