import { fail, guarded, ok } from "@/lib/api"
import { isValidSymbol, normalizeSymbol, toMarket } from "@/lib/symbol"
import { invalidateWatchlist } from "@/lib/cache"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ symbol: string }> }

export async function DELETE(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { symbol: raw } = await params
    if (!isValidSymbol(raw)) return fail("VALIDATION_ERROR", "That is not a valid symbol.")

    const supabase = await createClient()
    // RLS scopes the delete to the caller; another user's row simply matches nothing.
    const { data, error } = await supabase
      .from("watchlist_items")
      .delete()
      .eq("symbol", normalizeSymbol(raw))
      .eq("market", toMarket(new URL(request.url).searchParams.get("market")))
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (data) invalidateWatchlist()
    return data ? ok({ id: data.id }) : fail("NOT_FOUND", "That stock is not on your watchlist.")
  })
}
