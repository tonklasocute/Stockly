import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { normalizeSymbol, symbolKey, toMarket, type MarketId } from "@/domain/market"
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

/**
 * A starting universe so a brand-new account is not screening an empty list.
 *
 * US-only, deliberately. Every symbol here costs an OHLCV request on every refresh cycle, and
 * seeding Thai names for an account that holds none would spend a scarce quota on data nobody
 * asked for. SET symbols enter the universe the moment a user holds, watches or alerts on one —
 * which is the same rule that has always applied to US symbols outside this list.
 */
export const DEFAULT_UNIVERSE = [
  "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN", "META", "TSLA", "AMD",
  "AVGO", "NFLX", "COST", "PLTR", "SOFI", "UBER", "SHOP", "CRM",
] as const

/** How many symbols one refresh will price. A hard ceiling on what a single run can cost. */
export const MAX_UNIVERSE_SIZE = 60

/** An instrument in the universe. Market is carried because a symbol alone does not identify one. */
export type UniverseEntry = { symbol: string; market: MarketId }

export async function resolveUniverse(
  supabase: SupabaseClient<Database>,
): Promise<UniverseEntry[]> {
  const entries = new Map<string, UniverseEntry>()
  for (const symbol of DEFAULT_UNIVERSE) {
    entries.set(symbolKey(symbol, "US"), { symbol, market: "US" })
  }

  // Three cheap reads rather than one join: each is a single-column scan on an indexed table, and
  // they are independent.
  const [transactions, watchlist, alerts] = await Promise.all([
    supabase.from("transactions").select("symbol, market"),
    supabase.from("watchlist_items").select("symbol, market"),
    supabase.from("alerts").select("symbol, market").eq("enabled", true),
  ])

  for (const rows of [transactions.data, watchlist.data, alerts.data]) {
    for (const row of rows ?? []) {
      const symbol = normalizeSymbol(row.symbol ?? "")
      if (!symbol) continue
      const market = toMarket(row.market)
      entries.set(symbolKey(symbol, market), { symbol, market })
    }
  }

  return [...entries.values()].slice(0, MAX_UNIVERSE_SIZE)
}
