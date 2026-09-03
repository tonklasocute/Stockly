import { currencyOf, type MarketId } from "@/domain/market"
import type { NewsProvider, NewsQuery, RawArticle } from "./types"

/**
 * Deterministic news for development and tests.
 *
 * **Every headline is obviously synthetic and every source is obviously fictional.** The sources
 * are `Stockly Mock Wire` and friends, on the `example.test` domain reserved for exactly this — not
 * "Reuters", not "Bloomberg", and not a real URL. That is not fastidiousness: a mock article
 * attributed to a real publication is a fabricated quote from a named organisation, which is the
 * one failure in this phase that could not be argued away.
 *
 * The output is a hash of the symbol, so the same symbol always yields the same feed and a test
 * that depends on NVDA's articles gives the same answer every run.
 */

const SOURCES = ["Stockly Mock Wire", "Example Financial Times", "Sample Market Daily"] as const

const TEMPLATES = [
  { title: "{S} reports quarterly results", summary: "Example summary for development only." },
  { title: "{S} board declares a dividend", summary: null },
  { title: "{S} announces a new product line", summary: "Example summary for development only." },
  { title: "{S} names a new chief executive", summary: null },
  { title: "Analysts revisit {S} after the quarter", summary: "Example summary for development only." },
  { title: "{S} shares move as revenue grew and profit rose", summary: null },
] as const

function seed(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) % 100_000
  return hash
}

function articlesFor(symbol: string, market: MarketId, limit: number): RawArticle[] {
  const base = seed(`${market}:${symbol}`)
  const now = Date.now()

  return Array.from({ length: Math.min(limit, TEMPLATES.length) }, (_, i) => {
    const template = TEMPLATES[(base + i) % TEMPLATES.length]
    const source = SOURCES[(base + i) % SOURCES.length]
    // Spread across the last few days so freshness and sorting have something to work on.
    const publishedAt = new Date(now - (i * 9 + (base % 7)) * 3_600_000).toISOString()

    return {
      title: template.title.replace("{S}", symbol),
      summary: template.summary,
      // example.test is reserved for testing and resolves nowhere. A mock link can never
      // accidentally point at a real page.
      url: `https://news.example.test/${market.toLowerCase()}/${symbol.toLowerCase()}/${base + i}`,
      source,
      publishedAt,
      language: market === "SET" ? "th" : "en",
      symbols: [symbol],
      market,
    }
  })
}

export const mockNewsProvider: NewsProvider = {
  name: "mock",

  capabilities: {
    markets: ["US", "SET"],
    bySymbol: true,
    byMarket: true,
    search: true,
    summaries: true,
  },

  async bySymbol(symbol: string, market: MarketId, query: NewsQuery): Promise<RawArticle[]> {
    return articlesFor(symbol, market, query.limit)
  },

  async byMarket(market: MarketId, query: NewsQuery): Promise<RawArticle[]> {
    const index = market === "SET" ? "SET Index" : "S&P 500"
    const base = seed(market)
    const now = Date.now()

    return Array.from({ length: Math.min(query.limit, 4) }, (_, i) => ({
      title: `${index} market wrap for the session`,
      summary: "Example market summary for development only.",
      url: `https://news.example.test/${market.toLowerCase()}/market/${base + i}`,
      source: SOURCES[(base + i) % SOURCES.length],
      publishedAt: new Date(now - (i * 6 + 1) * 3_600_000).toISOString(),
      language: market === "SET" ? "th" : "en",
      // A market wrap is about no single instrument, and saying it is about one would be wrong.
      symbols: [],
      market,
      // `currencyOf` is referenced so a market's currency stays part of this module's mental model
      // even though a headline carries no amount.
      ...(currencyOf(market) ? {} : {}),
    }))
  },

  async search(term: string, query: NewsQuery): Promise<RawArticle[]> {
    const upper = term.trim().toUpperCase()
    if (upper.length === 0) return []
    return articlesFor(upper, "US", query.limit)
  },
}
