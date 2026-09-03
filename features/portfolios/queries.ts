import "server-only"

import { createClient } from "@/lib/supabase/server"
import { loadPreferences } from "@/features/personalization/queries"
import type { PortfolioRow } from "@/types/database"

export async function listPortfolios(): Promise<PortfolioRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("portfolios")
    .select("*")
    .order("created_at", { ascending: true })

  if (error) throw error
  return data ?? []
}

/**
 * The portfolio the user is looking at.
 *
 * Three sources, in the only order that makes sense: **the URL wins**, because a link somebody
 * followed says exactly which portfolio they meant; then the default they chose in preferences;
 * then the first one they created. RLS means an id belonging to somebody else simply returns
 * nothing, so an unrecognised `?p=` falls through to the default rather than erroring.
 *
 * A default that has since been deleted also falls through — the foreign key is
 * `on delete set null`, but a preference row read a moment before a deletion would still name it.
 */
export async function resolveActivePortfolio(
  requestedId?: string,
): Promise<{ portfolios: PortfolioRow[]; active: PortfolioRow | null }> {
  const [portfolios, preferences] = await Promise.all([
    listPortfolios(),
    // Never lets a preference break the page: the portfolio list is what matters here.
    loadPreferences().catch(() => null),
  ])

  const active =
    portfolios.find((p) => p.id === requestedId) ??
    portfolios.find((p) => p.id === preferences?.defaultPortfolioId) ??
    portfolios[0] ??
    null

  return { portfolios, active }
}
