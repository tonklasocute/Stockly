import type { MarketId } from "@/domain/market"
import type { NewsArticle, NewsCategory } from "@/domain/news"

/**
 * The news provider contract.
 *
 * Same shape as `MarketDataProvider` and `FundamentalDataProvider`: an interface here, an adapter
 * per vendor, a router that picks one, and no vendor name outside this folder.
 *
 * As with fundamentals, `capabilities` is part of the contract — news coverage is uneven, and a
 * deployment with no provider must be able to say so rather than showing an empty feed that reads
 * as "nothing is happening".
 *
 * **A provider returns raw articles; it does not classify them.** Category, sentiment, dedupe key
 * and relevance are all computed by `domain/news.ts`, so two providers cannot disagree about what
 * category an article is, and a provider cannot smuggle a sentiment Stockly did not derive.
 */

export type NewsCapabilities = {
  markets: readonly MarketId[]
  /** Whether the provider can answer a query about one instrument. */
  bySymbol: boolean
  /** Whether it can answer a market-wide query. */
  byMarket: boolean
  search: boolean
  /**
   * Whether the provider supplies its own summaries.
   *
   * When false, Stockly shows the headline alone — it **never** generates a summary from a headline,
   * which would be fabricating content and attributing it to a publication.
   */
  summaries: boolean
}

export type NewsQuery = {
  /** How many articles, bounded by the adapter. */
  limit: number
  /** Only articles published on or after this ISO date. */
  since?: string
  categories?: readonly NewsCategory[]
}

/** What a provider returns before Stockly classifies it. */
export type RawArticle = {
  title: string
  summary: string | null
  url: string
  source: string
  publishedAt: string
  language: string | null
  /** Symbols the provider says the article is about, as bare tickers. */
  symbols: readonly string[]
  market: MarketId | null
}

export interface NewsProvider {
  readonly name: string
  readonly capabilities: NewsCapabilities

  /** Articles about one instrument. `[]` is a normal answer, not an error. */
  bySymbol(symbol: string, market: MarketId, query: NewsQuery): Promise<RawArticle[]>

  /** Market-wide context. */
  byMarket(market: MarketId, query: NewsQuery): Promise<RawArticle[]>

  /** Free-text search, when the provider supports it. */
  search(term: string, query: NewsQuery): Promise<RawArticle[]>
}

/** Re-exported so callers type against the normalized article, not the raw one. */
export type { NewsArticle }
