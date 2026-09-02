import "server-only"

import { createClient } from "@/lib/supabase/server"

/**
 * The portfolio's own name, as a fallback for a share that has no display name.
 *
 * Its own tiny module because `publish.ts` needs exactly this one field and importing the portfolio
 * feature's list query would fetch every portfolio the user owns to read one string.
 *
 * Returns null when the id is not the caller's — RLS answers that, so a portfolio belonging to
 * somebody else is indistinguishable from one that does not exist.
 */
export async function readPortfolioName(portfolioId: string): Promise<string | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("portfolios")
    .select("name")
    .eq("id", portfolioId)
    .maybeSingle()

  if (error) throw error
  return data?.name ?? null
}
