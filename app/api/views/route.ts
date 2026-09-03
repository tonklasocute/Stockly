import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidatePersonalization } from "@/lib/cache"
import { listSavedViews } from "@/features/personalization/queries"
import { MAX_SAVED_VIEWS, savedViewSchema } from "@/features/personalization/schema"
import { createClient } from "@/lib/supabase/server"

/**
 * Saved views.
 *
 * A view is **a filter, a sort, a set of columns and a grouping** — not a portfolio and not a
 * figure. It stores no number, so it cannot go stale and cannot disagree with the table it
 * configures; everything it shows is recomputed by the engine on each render.
 *
 * The config is validated against closed enums server-side as well as in the browser, because a
 * persisted configuration is read back and rendered later: a client that posted an unknown filter
 * field would be storing something a future render has to cope with.
 */
export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId") ?? undefined
    return ok({ views: await listSavedViews(portfolioId) })
  })
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, savedViewSchema)
    const supabase = await createClient()

    const { count } = await supabase.from("saved_views").select("id", { count: "exact", head: true })
    if ((count ?? 0) >= MAX_SAVED_VIEWS) {
      throw new ApiError("CONFLICT", `You can save at most ${MAX_SAVED_VIEWS} views.`)
    }

    const { data, error } = await supabase
      .from("saved_views")
      .insert({
        user_id: userId, // from the session, never the body
        portfolio_id: body.portfolioId,
        name: body.name,
        config: body.config,
      })
      .select("*")
      .single()

    if (error?.code === "23505") throw new ApiError("CONFLICT", "You already have a view with that name.")
    if (error?.code === "23503") throw new ApiError("NOT_FOUND", "That portfolio does not exist.")
    if (error) throw error

    invalidatePersonalization()
    return ok(data, 201)
  })
}
