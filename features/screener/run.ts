import "server-only"

import {
  runScreen,
  type ScreenerCandidate,
  type ScreenerDefinition,
  type ScreenerResult,
} from "@/domain/screener"
import type { TechnicalSnapshot } from "@/domain/technical"
import { readAllSnapshots, type StoredSnapshot } from "@/features/technical/snapshots"
import { currencyOf, symbolKey, type Currency, type MarketId } from "@/domain/market"
import { PAGE_SIZE, toPageResult, type Page } from "@/lib/pagination"
import { getQuotesFor } from "@/services/market-data"

export type ScreenerRow = {
  symbol: string
  market: MarketId
  /**
   * The currency `price` is in — the instrument's own. A screener compares indicators, which are
   * unitless or ratios, so nothing here depends on the user's portfolio currency; only the price
   * column does, and it is shown in the currency it was quoted in.
   */
  currency: Currency
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
  market?: MarketId,
): Promise<ScreenerRunResult> {
  const all = await readAllSnapshots()
  // Scoping the universe, not the thresholds: a market filter decides which instruments are
  // examined and changes no reading on any of them.
  const stored = market
    ? new Map([...all].filter(([, entry]) => entry.market === market))
    : all

  const candidates: ScreenerCandidate[] = [...stored.values()].map((entry) => ({
    snapshot: entry.snapshot,
    // Market cap is not on the snapshot; a screen that filters on it is answered from the quote
    // below, so it is null here and such filters simply exclude everything until then.
    context: { marketCap: null, volume: entry.snapshot.averageVolume },
  }))

  const result: ScreenerResult = runScreen(candidates, definition)
  const from = (page - 1) * pageSize
  const pageMatches = result.matches.slice(from, from + pageSize)

  /**
   * Back from a matched snapshot to the row it came from, by object identity.
   *
   * A symbol lookup would be ambiguous exactly where it matters — two venues can list the same
   * three letters — and `runScreen` hands back the very snapshot objects it was given, so identity
   * is both exact and free.
   */
  const entryOf = new Map<TechnicalSnapshot, StoredSnapshot>(
    [...stored.values()].map((entry) => [entry.snapshot, entry]),
  )

  const pageInstruments = pageMatches
    .map((m) => entryOf.get(m.snapshot))
    .filter((e): e is StoredSnapshot => e !== undefined)
    .map((e) => ({ symbol: e.snapshot.symbol, market: e.market }))

  // Prices for this page only — a page of 25 symbols, not the whole universe. One call per market.
  let quotes = new Map<string, { name: string | null; price: number }>()
  if (pageInstruments.length > 0) {
    const priced = await getQuotesFor(pageInstruments)
    quotes = new Map(
      [...priced.quotes].map(([key, q]) => [key, { name: q.name, price: q.price }]),
    )
  }

  const rows: ScreenerRow[] = pageMatches.map(({ snapshot }) => {
    const entry = entryOf.get(snapshot) as StoredSnapshot
    const key = symbolKey(snapshot.symbol, entry.market)
    return {
      symbol: snapshot.symbol,
      market: entry.market,
      currency: currencyOf(entry.market),
      name: quotes.get(key)?.name ?? null,
      price: quotes.get(key)?.price ?? snapshot.price,
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
