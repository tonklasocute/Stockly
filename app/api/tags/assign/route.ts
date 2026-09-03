import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePersonalization } from "@/lib/cache"
import { holdingTagSchema } from "@/features/personalization/schema"
import { normalizeSymbol } from "@/domain/market"
import { createClient } from "@/lib/supabase/server"

/**
 * Applying a tag to a position, and taking it off again.
 *
 * The row is keyed by `(portfolio, market, symbol)` and never by a holding id, because a holding is
 * not a row — it is derived by replaying transactions. Tagging a holding id would mean inventing
 * one, which is the first step towards a second source of truth.
 *
 * Two independent ownership checks apply and neither is this handler's code: the composite foreign
 * key means the portfolio must belong to the caller, and RLS means the tag must too.
 */
export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, holdingTagSchema)
    const supabase = await createClient()

    const { error } = await supabase.from("holding_tags").insert({
      user_id: userId, // from the session, never the body
      portfolio_id: body.portfolioId,
      tag_id: body.tagId,
      market: body.market,
      symbol: normalizeSymbol(body.symbol),
    })

    // Applying a tag twice is not an error; it is the same state.
    if (error && error.code !== "23505") {
      if (error.code === "23503") throw new ApiError("NOT_FOUND", "That portfolio or tag does not exist.")
      throw error
    }

    invalidatePersonalization()
    return ok({ assigned: true }, 201)
  })
}

export async function DELETE(request: Request) {
  return guarded(async () => {
    const body = await parseBody(request, holdingTagSchema)
    const supabase = await createClient()

    const { error } = await supabase
      .from("holding_tags")
      .delete()
      .eq("portfolio_id", body.portfolioId)
      .eq("tag_id", body.tagId)
      .eq("market", body.market)
      .eq("symbol", normalizeSymbol(body.symbol))

    if (error) throw error
    invalidatePersonalization()
    return ok({ removed: true })
  })
}
