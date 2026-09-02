import "server-only"

import { createClient } from "@/lib/supabase/server"
import { readSnapshots, type StoredSnapshot } from "@/features/technical/snapshots"
import { symbolKey, toMarket } from "@/domain/market"
import { getQuotesFor, type Quote } from "@/services/market-data"
import type { WatchlistItemRow } from "@/types/database"

export async function listWatchlist(): Promise<WatchlistItemRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("watchlist_items")
    .select("*")
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => ({
    ...row,
    target_price: row.target_price === null ? null : Number(row.target_price),
  }))
}

/** Rows plus one batched quote call. A provider outage still renders the list, without prices. */
export async function loadWatchlist(): Promise<{
  items: WatchlistItemRow[]
  quotes: Map<string, Quote>
  technicals: Map<string, StoredSnapshot>
  marketDataError: string | null
}> {
  const items = await listWatchlist()
  if (items.length === 0) {
    return { items, quotes: new Map(), technicals: new Map(), marketDataError: null }
  }

  const instruments = items.map((i) => ({ symbol: i.symbol, market: toMarket(i.market) }))
  // Snapshots come from the cache, so adding technical columns costs a database read and no
  // upstream requests at all. Both maps are keyed by `symbolKey`, matching a mixed-market list.
  const [technicals, priced] = await Promise.all([
    readSnapshots(instruments),
    // One batched call per market: a Thai outage still leaves the US rows priced.
    getQuotesFor(instruments),
  ])

  return {
    items,
    quotes: priced.quotes,
    technicals,
    marketDataError: priced.error?.message ?? null,
  }
}

/** The key a watchlist row's quote and snapshot are stored under. */
export function watchlistKey(item: { symbol: string; market: string }): string {
  return symbolKey(item.symbol, toMarket(item.market))
}

/** Symbols on the watchlist, so a stock page can render the right star without a second query. */
export async function watchedSymbols(): Promise<Set<string>> {
  const supabase = await createClient()
  const { data } = await supabase.from("watchlist_items").select("symbol, market")
  return new Set((data ?? []).map((row) => symbolKey(row.symbol, toMarket(row.market))))
}
