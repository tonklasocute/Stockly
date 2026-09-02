import "server-only"

import { cache } from "react"
import { DEFAULT_SHARE_CONFIG, type ShareConfig } from "@/domain/sharing"
import { createClient } from "@/lib/supabase/server"
import type {
  PortfolioShareLinkRow,
  PortfolioShareRow,
  PublishedShareRow,
  ShareEventRow,
  ShareSnapshotRow,
} from "@/types/database"

/**
 * The owner's own view of their sharing setup. Every query runs under RLS, so a portfolio id
 * belonging to somebody else returns nothing rather than an error — which is also the behaviour
 * that keeps existence itself private.
 */

export const loadShare = cache(async (portfolioId: string): Promise<PortfolioShareRow | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("portfolio_shares")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .maybeSingle()

  if (error) throw error
  return data ?? null
})

/**
 * A row, or the all-off default.
 *
 * **A portfolio with no share row is private**, and that is expressed as the absence of a row
 * rather than a row full of falses that somebody has to remember to write. The default is what the
 * feature does before anyone touches it.
 */
export function toConfig(row: PortfolioShareRow | null): ShareConfig {
  if (!row) return DEFAULT_SHARE_CONFIG
  return {
    visibility: row.visibility,
    slug: row.slug,
    displayName: row.display_name,
    description: row.description,
    ownerDisplayName: row.owner_display_name,
    showOverview: row.show_overview,
    showHoldings: row.show_holdings,
    showAllocation: row.show_allocation,
    showPerformance: row.show_performance,
    showRisk: row.show_risk,
    showDividends: row.show_dividends,
    showBenchmark: row.show_benchmark,
    showInsights: row.show_insights,
    showGoals: row.show_goals,
    showAbsoluteValues: row.show_absolute_values,
    showQuantity: row.show_quantity,
    showUnrealizedPnl: row.show_unrealized_pnl,
    showRealizedPnl: row.show_realized_pnl,
    showCash: row.show_cash,
    allowSearchIndexing: row.allow_search_indexing,
  }
}

/** The database column names for a config, so the write and the read cannot drift apart. */
export function toRow(config: ShareConfig): Omit<PortfolioShareRow, "id" | "portfolio_id" | "user_id" | "created_at" | "updated_at" | "settings_version"> {
  return {
    visibility: config.visibility,
    slug: config.slug,
    display_name: config.displayName,
    description: config.description,
    owner_display_name: config.ownerDisplayName,
    show_overview: config.showOverview,
    show_holdings: config.showHoldings,
    show_allocation: config.showAllocation,
    show_performance: config.showPerformance,
    show_risk: config.showRisk,
    show_dividends: config.showDividends,
    show_benchmark: config.showBenchmark,
    show_insights: config.showInsights,
    show_goals: config.showGoals,
    show_absolute_values: config.showAbsoluteValues,
    show_quantity: config.showQuantity,
    show_unrealized_pnl: config.showUnrealizedPnl,
    show_realized_pnl: config.showRealizedPnl,
    show_cash: config.showCash,
    allow_search_indexing: config.allowSearchIndexing,
  }
}

export async function listShareLinks(portfolioId: string): Promise<PortfolioShareLinkRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("portfolio_share_links")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: false })

  if (error) throw error
  return data ?? []
}

/**
 * Snapshots without their payloads.
 *
 * The list page shows a date and a label; loading fifty rendered documents to draw fifty rows would
 * move a quarter of a megabyte per snapshot for nothing.
 */
export async function listSnapshots(
  portfolioId: string,
): Promise<Omit<ShareSnapshotRow, "payload">[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("share_snapshots")
    .select("id, portfolio_id, user_id, token_hash, version, label, base_currency, calculated_at, created_at")
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: false })
    .limit(50)

  if (error) throw error
  return data ?? []
}

export async function loadPublished(portfolioId: string): Promise<PublishedShareRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("published_shares")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .maybeSingle()

  if (error) throw error
  return data ?? null
}

export async function listShareEvents(portfolioId: string, limit = 20): Promise<ShareEventRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("share_events")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

/**
 * Whether a public address looks free.
 *
 * Honest about its limits: RLS scopes `portfolio_shares` to the caller, so this can only see the
 * caller's own rows. An address taken by somebody else returns "available" here and then fails on
 * the unique constraint, which the route maps to a plain "already taken".
 *
 * That is the right way round. The constraint is what actually decides; this exists only to catch
 * the common case — an owner reusing an address across their own portfolios — without a round trip
 * that would let anyone probe which addresses exist.
 */
export async function slugAvailable(slug: string, portfolioId: string): Promise<boolean> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("portfolio_shares")
    .select("portfolio_id")
    .eq("slug", slug)
    .maybeSingle()

  if (error) throw error
  return !data || data.portfolio_id === portfolioId
}
