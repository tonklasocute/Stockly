import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeSymbol } from "@/lib/symbol"
import type { Database } from "@/types/database"

/**
 * The screener universe.
 *
 * **This is the honest ceiling of phase 6.** A full-market screener means an OHLCV history for every
 * listed stock; the provider bills one credit per symbol per request and allows eight a minute, so
 * scanning five thousand names is not slow, it is impossible — it would take ten hours and exceed
 * the daily quota twenty times over.
 *
 * So the universe is what this deployment's users actually track: every symbol held, watched or
 * alerted on, plus a small default list so a new account has something to screen. That is a few
 * dozen symbols, refreshed once per cron run and shared by everyone.
 *
 * `ponytail:` ceiling — a market-wide screener needs a provider with a bulk endpoint (a daily
 * snapshot file, or a screener API). When one is in place, only this function changes: everything
 * downstream already works from a list of symbols.
 */

/** A starting universe so a brand-new account is not screening an empty list. */
export const DEFAULT_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AMD",
  "AVGO", "NFLX", "COST", "PLTR", "SOFI", "UBER", "SHOP", "CRM",
] as const

/** How many symbols one refresh will price. A hard ceiling on what a single run can cost. */
export const MAX_UNIVERSE_SIZE = 60

export async function resolveUniverse(
  supabase: SupabaseClient<Database>,
): Promise<string[]> {
  const symbols = new Set<string>(DEFAULT_UNIVERSE)

  // Three cheap reads rather than one join: each is a single-column scan on an indexed table, and
  // they are independent.
  const [transactions, watchlist, alerts] = await Promise.all([
    supabase.from("transactions").select("symbol"),
    supabase.from("watchlist_items").select("symbol"),
    supabase.from("alerts").select("symbol").eq("enabled", true),
  ])

  for (const rows of [transactions.data, watchlist.data, alerts.data]) {
    for (const row of rows ?? []) {
      const symbol = normalizeSymbol(row.symbol ?? "")
      if (symbol) symbols.add(symbol)
    }
  }

  return [...symbols].slice(0, MAX_UNIVERSE_SIZE)
}
