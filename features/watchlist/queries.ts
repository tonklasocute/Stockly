import "server-only"

import { createClient } from "@/lib/supabase/server"
import { readSnapshots, type StoredSnapshot } from "@/features/technical/snapshots"
import { getMarketDataProvider, isMarketDataError, type Quote } from "@/services/market-data"
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

  const symbols = items.map((i) => i.symbol)
  // Snapshots come from the cache, so adding technical columns costs a database read and no
  // upstream requests at all.
  const technicals = await readSnapshots(symbols)

  try {
    const quotes = await getMarketDataProvider().getQuotes(symbols)
    return { items, quotes, technicals, marketDataError: null }
  } catch (error) {
    console.error("[watchlist] quotes failed", error)
    return {
      items,
      quotes: new Map(),
      technicals,
      marketDataError: isMarketDataError(error)
        ? error.message
        : "Unable to load market data. Please try again later.",
    }
  }
}

/** Symbols on the watchlist, so a stock page can render the right star without a second query. */
export async function watchedSymbols(): Promise<Set<string>> {
  const supabase = await createClient()
  const { data } = await supabase.from("watchlist_items").select("symbol, market")
  return new Set((data ?? []).map((row) => `${row.market}:${row.symbol}`))
}
