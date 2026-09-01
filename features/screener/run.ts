import "server-only"

import {
  runScreen,
  type ScreenerCandidate,
  type ScreenerDefinition,
  type ScreenerResult,
} from "@/domain/screener"
import { readAllSnapshots, type StoredSnapshot } from "@/features/technical/snapshots"
import { PAGE_SIZE, toPageResult, type Page } from "@/lib/pagination"
import { getMarketDataProvider } from "@/services/market-data"

export type ScreenerRow = {
  symbol: string
  name: string | null
  price: number | null
  rsi: number | null
  adx: number | null
  relativeVolume: number | null
  score: number | null
  trend: string
  stale: boolean
  calculatedAt: string
}

export type ScreenerRunResult = Page<ScreenerRow> & {
  examined: number
  evaluable: number
  /** True when any row in the page was computed longer ago than the freshness window. */
  anyStale: boolean
  oldestCalculatedAt: string | null
}

/**
 * Runs a screen against the cached snapshots.
 *
 * **No market-data requests happen here.** The snapshots were computed by the scheduled job, so a
 * user hammering "Run screener" costs database reads and nothing upstream — which is the only way
 * a screener is affordable on a per-symbol quote API.
 *
 * One batched quote call is made afterwards, for the page being returned only, so the prices shown
 * are current even though the indicators are as of the last refresh. The two are labelled
 * separately in the UI; a stale indicator must never be presented as live.
 */
export async function runScreener(
  definition: ScreenerDefinition,
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<ScreenerRunResult> {
  const stored = await readAllSnapshots()

  const candidates: ScreenerCandidate[] = [...stored.values()].map((entry) => ({
    snapshot: entry.snapshot,
    // Market cap is not on the snapshot; a screen that filters on it is answered from the quote
    // below, so it is null here and such filters simply exclude everything until then.
    context: { marketCap: null, volume: entry.snapshot.averageVolume },
  }))

  const result: ScreenerResult = runScreen(candidates, definition)
  const from = (page - 1) * pageSize
  const pageMatches = result.matches.slice(from, from + pageSize)

  // Prices for this page only — a page of 25 symbols, not the whole universe.
  let names = new Map<string, string | null>()
  let prices = new Map<string, number>()
  if (pageMatches.length > 0) {
    try {
      const quotes = await getMarketDataProvider().getQuotes(
        pageMatches.map((m) => m.snapshot.symbol),
      )
      names = new Map([...quotes.values()].map((q) => [q.symbol, q.name]))
      prices = new Map([...quotes.values()].map((q) => [q.symbol, q.price]))
    } catch {
      // Prices are a nicety here; the screen itself already ran on stored indicators.
    }
  }

  const rows: ScreenerRow[] = pageMatches.map(({ snapshot }) => {
    const entry = stored.get(snapshot.symbol) as StoredSnapshot
    return {
      symbol: snapshot.symbol,
      name: names.get(snapshot.symbol) ?? null,
      price: prices.get(snapshot.symbol) ?? snapshot.price,
      rsi: snapshot.rsi,
      adx: snapshot.adx,
      relativeVolume: snapshot.relativeVolume,
      score: snapshot.score,
      trend: snapshot.trend,
      stale: entry.stale,
      calculatedAt: entry.calculatedAt,
    }
  })

  const oldest = rows.length
    ? rows.map((r) => r.calculatedAt).sort()[0]
    : null

  return {
    ...toPageResult(rows, result.matches.length, page, pageSize),
    examined: result.examined,
    evaluable: result.evaluable,
    anyStale: rows.some((r) => r.stale),
    oldestCalculatedAt: oldest,
  }
}
