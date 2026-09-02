import "server-only"

import { cache } from "react"
import { groupByMarket, symbolKey, MARKETS, type MarketId } from "@/domain/market"
import { serverEnv } from "@/lib/env.server"
import { MarketDataError } from "./errors"
import { mockMarketDataProvider } from "./mock-provider"
import { createTwelveDataProvider } from "./twelve-data-provider"
import type { InstrumentSummary, MarketDataProvider, MarketStatus, Quote } from "./types"

/**
 * Provider selection and routing.
 *
 * Two ideas live here and nowhere else:
 *
 * 1. **Which implementation.** Adding Polygon or a Thai vendor is a new adapter plus one case in
 *    `create`. No provider name appears outside this folder.
 * 2. **Which market goes to which implementation.** `getQuotesFor` groups instruments by market and
 *    calls each provider once. That is what keeps `if (market === "TH")` out of the rest of the
 *    application — the branch exists exactly once, here, as a lookup.
 *
 * Server-only: every adapter closes over the API key, which must never reach the browser.
 */
function create(name: string): MarketDataProvider {
  switch (name) {
    case "mock":
      return mockMarketDataProvider

    case "twelvedata": {
      if (!serverEnv.marketDataApiKey) throw MarketDataError.notConfigured()
      return createTwelveDataProvider({
        apiKey: serverEnv.marketDataApiKey,
        baseUrl: serverEnv.marketDataBaseUrl,
      })
    }

    default:
      console.warn(`[market-data] Unknown provider "${name}"; using mock prices instead.`)
      return mockMarketDataProvider
  }
}

/** Which provider is configured for each market. One variable per market, defaulting to the main one. */
function providerNameFor(market: MarketId): string {
  return market === "SET" ? serverEnv.setMarketDataProvider : serverEnv.marketDataProvider
}

/**
 * The provider for one market. Defaults to US so every phase 2–8 call site keeps working unchanged.
 *
 * `cache()` memoises per market within a render, so a page pricing two markets constructs two
 * adapters and not one per holding.
 */
export const getMarketDataProvider = cache((market: MarketId = "US"): MarketDataProvider => {
  const provider = create(providerNameFor(market))
  // A provider that does not cover this market would answer with a price from somewhere else — a
  // plausible number in the wrong currency, which is worse than no number at all.
  if (!provider.markets.includes(market)) throw MarketDataError.notConfigured()
  return provider
})

/** Anything that names an instrument: a holding, a watchlist row, an alert. */
export type InstrumentRef = { symbol: string; market: MarketId }

/**
 * Quotes for a mixed-market set of instruments: **one batched call per market**, never one per
 * instrument. The result is keyed by `symbolKey` (`"SET:PTT"`), because a bare symbol is only
 * unique inside one market and two venues sharing a spelling would otherwise overwrite each other.
 *
 * A market whose provider fails contributes nothing and is named in `failed`. The others still
 * return: a Thai outage must not blank out a US portfolio.
 */
export async function getQuotesFor(
  instruments: readonly InstrumentRef[],
): Promise<{ quotes: Map<string, Quote>; failed: MarketId[]; error: MarketDataError | null }> {
  const quotes = new Map<string, Quote>()
  const failed: MarketId[] = []
  let error: MarketDataError | null = null

  const byMarket = groupByMarket(instruments)
  await Promise.all(
    [...byMarket.entries()].map(async ([market, refs]) => {
      const symbols = [...new Set(refs.map((r) => r.symbol))]
      if (symbols.length === 0) return
      try {
        const found = await getMarketDataProvider(market).getQuotes(symbols, market)
        for (const quote of found.values()) quotes.set(symbolKey(quote.symbol, market), quote)
      } catch (caught) {
        failed.push(market)
        if (caught instanceof MarketDataError) error ??= caught
        else error ??= MarketDataError.unavailable(caught)
      }
    }),
  )

  return { quotes, failed, error }
}

/**
 * Search across every configured market, or one when asked.
 *
 * Providers are de-duplicated by name: with the same adapter serving both markets — the common case
 * — this is one upstream call whose results are already tagged with their venue, not two.
 */
export async function searchInstruments(
  query: string,
  market?: MarketId,
): Promise<InstrumentSummary[]> {
  const markets = market ? [market] : MARKETS
  const seen = new Set<string>()
  const providers: Array<{ provider: MarketDataProvider; market: MarketId | undefined }> = []

  for (const id of markets) {
    let provider: MarketDataProvider
    try {
      provider = getMarketDataProvider(id)
    } catch {
      continue // A market with no configured provider simply contributes no results.
    }
    if (seen.has(provider.name)) continue
    seen.add(provider.name)
    // One adapter covering both markets is asked once, unscoped, and tags its own results.
    providers.push({ provider, market: market ?? undefined })
  }

  const results = await Promise.all(
    providers.map(({ provider, market: scope }) =>
      provider.searchSymbols(query, scope).catch(() => [] as InstrumentSummary[]),
    ),
  )

  const out = new Map<string, InstrumentSummary>()
  for (const list of results) {
    for (const item of list) out.set(symbolKey(item.symbol, item.market), item)
  }
  return [...out.values()].slice(0, 12)
}

/** Session state per market, for the data-health view. A failure is "unknown", never a guess. */
export async function getMarketStatuses(): Promise<Record<MarketId, MarketStatus>> {
  const entries = await Promise.all(
    MARKETS.map(async (market): Promise<[MarketId, MarketStatus]> => {
      try {
        return [market, await getMarketDataProvider(market).getMarketStatus(market)]
      } catch {
        return [market, "unknown"]
      }
    }),
  )
  return Object.fromEntries(entries) as Record<MarketId, MarketStatus>
}

export { MarketDataError, isMarketDataError } from "./errors"
export { RANGES } from "./types"
export type * from "./types"
