import { z } from "zod"
import {
  dismissInsight,
  recordRecent,
  resolveLayout,
  restoreInsight,
  togglePin,
  type PinnedItem,
} from "@/domain/personalization"
import { guarded, ok, parseBody } from "@/lib/api"
import { invalidatePersonalization } from "@/lib/cache"
import { loadPreferences } from "@/features/personalization/queries"
import { pinnedItemSchema, preferencesSchema } from "@/features/personalization/schema"
import { createClient } from "@/lib/supabase/server"

/**
 * One endpoint for the whole preference document.
 *
 * A PATCH rather than a PUT: the theme toggle, the density switch and the dashboard editor each
 * change one field, and making every one of them send the entire document would mean each could
 * silently revert the others. Whatever is absent is left alone.
 *
 * There is no `userId` in the body. The row's primary key comes from the session, and RLS refuses
 * anything else — so the endpoint has no notion of acting on somebody else's preferences.
 */
export async function GET() {
  return guarded(async () => ok(await loadPreferences()))
}

export async function PATCH(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, preferencesSchema)
    const supabase = await createClient()

    const patch: Record<string, unknown> = {}
    if (body.theme !== undefined) patch.theme = body.theme
    if (body.density !== undefined) patch.density = body.density
    if (body.defaultPortfolioId !== undefined) patch.default_portfolio_id = body.defaultPortfolioId
    if (body.favoriteMetrics !== undefined) patch.favorite_metrics = body.favoriteMetrics
    if (body.dismissedInsights !== undefined) patch.dismissed_insights = body.dismissedInsights
    if (body.dashboardLayout !== undefined) {
      /*
       * Resolved before it is written, not after it is read.
       *
       * The client posts what it rendered; the server stores what the registry says that means —
       * unknown widgets dropped, duplicates collapsed, required widgets forced visible. Storing the
       * raw claim would mean every later read has to repair it.
       */
      patch.dashboard_layout = resolveLayout(body.dashboardLayout)
    }

    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" })
    if (error) throw error

    invalidatePersonalization()
    return ok(await loadPreferences())
  })
}

/** Resetting the dashboard stores `[]`, which *means* the default rather than copying it. */
export async function DELETE() {
  return guarded(async (userId) => {
    const supabase = await createClient()
    const { error } = await supabase
      .from("user_preferences")
      .upsert({ user_id: userId, dashboard_layout: [] }, { onConflict: "user_id" })
    if (error) throw error

    invalidatePersonalization()
    return ok(await loadPreferences())
  })
}

/**
 * Pins, recents and insight dismissal.
 *
 * Folded into this route rather than given three of their own: all three are a read-modify-write of
 * one column on one row, and the domain function that decides the new value is the whole of the
 * logic. Three endpoints would be three sets of the same six lines.
 */
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("togglePin"), item: pinnedItemSchema }),
  z.object({ action: z.literal("recordRecent"), item: pinnedItemSchema }),
  z.object({ action: z.literal("dismissInsight"), code: z.string().trim().min(1).max(60) }),
  z.object({ action: z.literal("restoreInsight"), code: z.string().trim().min(1).max(60) }),
])

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, actionSchema)
    const current = await loadPreferences()
    const supabase = await createClient()

    const patch: Record<string, unknown> = {}
    let rejected: string | null = null

    switch (body.action) {
      case "togglePin": {
        const result = togglePin(current.pinnedItems, body.item as PinnedItem)
        // A limit is reported, never worked around by evicting something the user chose to pin.
        if (result.rejected) rejected = "You have pinned as many items as Stockly keeps."
        else patch.pinned_items = result.items
        break
      }
      case "recordRecent":
        patch.recent_items = recordRecent(current.recentItems, body.item as PinnedItem)
        break
      case "dismissInsight":
        // `dismissInsight` refuses the codes that explain why a figure on the same screen is wrong.
        patch.dismissed_insights = dismissInsight(current.dismissedInsights, body.code)
        break
      case "restoreInsight":
        patch.dismissed_insights = restoreInsight(current.dismissedInsights, body.code)
        break
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await supabase
        .from("user_preferences")
        .upsert({ user_id: userId, ...patch }, { onConflict: "user_id" })
      if (error) throw error
      invalidatePersonalization()
    }

    return ok({ preferences: await loadPreferences(), rejected })
  })
}
