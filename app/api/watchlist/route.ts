import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { listWatchlist } from "@/features/watchlist/queries"
import { watchlistInputSchema } from "@/features/watchlist/schema"
import { invalidateWatchlist } from "@/lib/cache"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  return guarded(async () => ok({ items: await listWatchlist() }))
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, watchlistInputSchema)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("watchlist_items")
      .insert({
        user_id: userId, // from the session, never the body
        symbol: body.symbol,
        market: body.market,
        name: body.name ?? null,
        exchange: body.exchange ?? null,
        target_price: body.targetPrice ?? null,
        notes: body.notes ?? null,
      })
      .select("*")
      .single()

    // The unique constraint is what actually prevents duplicates; this only phrases it for a user.
    if (error?.code === "23505") {
      throw new ApiError("CONFLICT", `${body.symbol} is already on your watchlist.`)
    }
    if (error) throw error

    invalidateWatchlist()
    return ok(data, 201)
  })
}
