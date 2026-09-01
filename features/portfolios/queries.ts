import "server-only"

import { createClient } from "@/lib/supabase/server"
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
 * The portfolio the user is looking at: the one in the URL if it is theirs, otherwise the first.
 * RLS means an id belonging to someone else simply returns nothing.
 */
export async function resolveActivePortfolio(
  requestedId?: string,
): Promise<{ portfolios: PortfolioRow[]; active: PortfolioRow | null }> {
  const portfolios = await listPortfolios()
  const active = portfolios.find((p) => p.id === requestedId) ?? portfolios[0] ?? null
  return { portfolios, active }
}
