import "server-only"

import { symbolKey, toMarket, type MarketId } from "@/domain/market"
import { createClient } from "@/lib/supabase/server"
import type { ThesisRow } from "@/types/database"

/** Every thesis in a portfolio, most recently touched first. RLS scopes the read to the caller. */
export async function listTheses(portfolioId: string): Promise<ThesisRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("investment_theses")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("updated_at", { ascending: false })

  if (error) throw error
  return data ?? []
}

/**
 * Theses keyed by `symbolKey`, for a page that renders many positions.
 *
 * One query for the whole portfolio rather than one per holding — the same rule as everywhere else,
 * and the reason a holdings table with a thesis badge on each row costs no extra round trips.
 */
export async function thesesByInstrument(portfolioId: string): Promise<Map<string, ThesisRow>> {
  const rows = await listTheses(portfolioId)
  const out = new Map<string, ThesisRow>()
  for (const row of rows) {
    const key = symbolKey(row.symbol, toMarket(row.market))
    // Ordered newest-first, and a CLOSED thesis never blocks an open one, so the first row for an
    // instrument is the one worth showing.
    if (!out.has(key)) out.set(key, row)
  }
  return out
}

/** The thesis for one instrument, if there is one. */
export async function findThesis(
  portfolioId: string,
  symbol: string,
  market: MarketId,
): Promise<ThesisRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("investment_theses")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .eq("symbol", symbol)
    .eq("market", market)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ?? null
}
