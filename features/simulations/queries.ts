import "server-only"

import { createClient } from "@/lib/supabase/server"
import type { SavedSimulationRow } from "@/types/database"

/**
 * A user's saved scenarios, most recently touched first.
 *
 * RLS scopes the read to the caller, so this needs no user filter and could not be given one that
 * mattered. Rows only — every figure a scenario produces is recomputed from `inputs` when it is
 * opened, by the same pure functions that produced it the first time.
 */
export async function listSimulations(portfolioId?: string): Promise<SavedSimulationRow[]> {
  const supabase = await createClient()
  let query = supabase.from("saved_simulations").select("*")
  // A portfolio's scenarios plus the standalone ones, which belong to no portfolio and are always
  // relevant — a compound-growth calculation is not about a particular book.
  if (portfolioId) query = query.or(`portfolio_id.eq.${portfolioId},portfolio_id.is.null`)

  const { data, error } = await query.order("updated_at", { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function findSimulation(id: string): Promise<SavedSimulationRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("saved_simulations")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) throw error
  return data ?? null
}
