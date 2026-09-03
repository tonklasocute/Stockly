import "server-only"

import { cache } from "react"
import {
  resolveLayout,
  resolveMetrics,
  type MetricId,
  type PinnedItem,
  type Theme,
  type Density,
  type WidgetPlacement,
} from "@/domain/personalization"
import { createClient } from "@/lib/supabase/server"
import type { HoldingTagRow, SavedViewRow, TagRow, UserPreferencesRow } from "@/types/database"

/**
 * Reading a user's personalization.
 *
 * Every query runs under RLS as the signed-in user, so there is no `where user_id = ...` to forget:
 * a row belonging to somebody else is not filtered out, it is not visible. That is also why none of
 * these functions takes a user id — there is nothing to pass and nothing to get wrong.
 */

export type Preferences = {
  theme: Theme
  density: Density
  defaultPortfolioId: string | null
  favoriteMetrics: MetricId[]
  dashboardLayout: WidgetPlacement[]
  dismissedInsights: string[]
  pinnedItems: PinnedItem[]
  recentItems: PinnedItem[]
}

/**
 * What a user with no preferences row gets.
 *
 * A new user has no row at all — nothing is written until they change something — so this is the
 * behaviour of the application before anybody touches it, not a placeholder.
 */
export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  density: "comfortable",
  defaultPortfolioId: null,
  favoriteMetrics: resolveMetrics(null),
  dashboardLayout: resolveLayout(null),
  dismissedInsights: [],
  pinnedItems: [],
  recentItems: [],
}

/**
 * jsonb comes back as `unknown`. Rather than trusting it, each document is narrowed to the shape
 * the domain expects and anything unrecognised is dropped — a row written by an older release is a
 * normal thing to encounter, not an error.
 */
function asArray<T>(value: unknown, guard: (item: unknown) => item is T): T[] {
  return Array.isArray(value) ? value.filter(guard) : []
}

const isString = (value: unknown): value is string => typeof value === "string"

const isPlacement = (value: unknown): value is WidgetPlacement =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as WidgetPlacement).id === "string" &&
  typeof (value as WidgetPlacement).visible === "boolean"

const isPinnedItem = (value: unknown): value is PinnedItem =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as PinnedItem).kind === "string" &&
  typeof (value as PinnedItem).ref === "string" &&
  typeof (value as PinnedItem).label === "string"

export function toPreferences(row: UserPreferencesRow | null): Preferences {
  if (!row) return { ...DEFAULT_PREFERENCES }
  return {
    theme: row.theme,
    density: row.density,
    defaultPortfolioId: row.default_portfolio_id,
    // Both resolve rather than validate: a stored layout is reconciled against the current widget
    // registry, so a release that adds or removes a widget cannot leave anyone with a broken page.
    favoriteMetrics: resolveMetrics(asArray(row.favorite_metrics, isString) as MetricId[]),
    dashboardLayout: resolveLayout(asArray(row.dashboard_layout, isPlacement)),
    dismissedInsights: asArray(row.dismissed_insights, isString),
    pinnedItems: asArray(row.pinned_items, isPinnedItem),
    recentItems: asArray(row.recent_items, isPinnedItem),
  }
}

/**
 * `cache()`d because the app shell, the dashboard and every table that honours density all need it
 * in one render. One row, once.
 */
export const loadPreferences = cache(async (): Promise<Preferences> => {
  const supabase = await createClient()
  const { data, error } = await supabase.from("user_preferences").select("*").maybeSingle()
  if (error) throw error
  return toPreferences(data ?? null)
})

export const listTags = cache(async (): Promise<TagRow[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase.from("tags").select("*").order("name")
  if (error) throw error
  return data ?? []
})

/**
 * Every tag assignment in one portfolio, as one query.
 *
 * Not one query per holding: a fifty-position portfolio would otherwise cost fifty round trips to
 * render a column of labels. The result is keyed by `symbolKey` so the caller can look a position
 * up in constant time.
 */
export async function loadHoldingTags(
  portfolioId: string,
): Promise<Map<string, { id: string; name: string; color: string }[]>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("holding_tags")
    .select("market, symbol, tag_id, tags(id, name, color)")
    .eq("portfolio_id", portfolioId)

  if (error) throw error

  const byInstrument = new Map<string, { id: string; name: string; color: string }[]>()
  for (const row of data ?? []) {
    const tag = (row as unknown as { tags: { id: string; name: string; color: string } | null }).tags
    if (!tag) continue
    const key = `${row.market}:${row.symbol}`
    const existing = byInstrument.get(key)
    if (existing) existing.push(tag)
    else byInstrument.set(key, [tag])
  }
  return byInstrument
}

export async function listHoldingTagRows(portfolioId: string): Promise<HoldingTagRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("holding_tags").select("*").eq("portfolio_id", portfolioId)
  if (error) throw error
  return data ?? []
}

export const listSavedViews = cache(async (portfolioId?: string): Promise<SavedViewRow[]> => {
  const supabase = await createClient()
  let query = supabase.from("saved_views").select("*").order("name")
  // A view with no portfolio applies everywhere — "Dividend stocks" is rarely about one portfolio.
  if (portfolioId) query = query.or(`portfolio_id.is.null,portfolio_id.eq.${portfolioId}`)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
})
