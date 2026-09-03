import "server-only"

import { cache } from "react"
import {
  ageOf,
  classifyCategory,
  classifySentiment,
  dedupeArticles,
  dedupeKeyFor,
  isPresentable,
  linkToEvents,
  sortArticles,
  type EventLink,
  type NewsArticle,
  type NewsCategory,
  type NewsSort,
  type RelevanceContext,
} from "@/domain/news"
import { symbolKey, type MarketId } from "@/domain/market"
import { coversMarket, getNewsProvider } from "@/services/news"
import type { RawArticle } from "@/services/news"
import { loadPortfolioView } from "@/features/portfolios/portfolio-view"
import { watchedSymbols } from "@/features/watchlist/queries"
import { describeError, logger } from "@/lib/log"

/**
 * The news feed, for one reader.
 *
 * Three properties this loader exists to guarantee:
 *
 * 1. **Classification happens here, never in a provider.** A provider returns a headline and a
 *    link; category, tone, dedupe key and relevance are all derived by `domain/news.ts`. Two
 *    providers therefore cannot disagree about what an article is, and no provider can smuggle in
 *    a sentiment Stockly did not compute.
 * 2. **Nothing unverifiable is shown.** `isPresentable` drops any article without a real title, a
 *    named source, a safe https link and a sane publication date. Dropped, not repaired — there is
 *    nothing to repair it from.
 * 3. **The reader's holdings never leave the server.** Relevance is computed here, under their own
 *    session; the response carries ranked articles and no statement about what they own.
 */

/** The most instruments one feed asks a provider about, so a large portfolio cannot mean 200 calls. */
export const MAX_FEED_INSTRUMENTS = 20

export type FeedScope = "PORTFOLIO" | "WATCHLIST" | "MARKET"

export type FeedArticle = NewsArticle & {
  /** Why this article is in the feed. Never a position size. */
  relation: "HELD" | "WATCHED" | "MARKET"
  events: EventLink[]
  age: ReturnType<typeof ageOf>
}

export type NewsBundle = {
  articles: FeedArticle[]
  /** False when this deployment has no news provider — a different empty state from "no news". */
  covered: boolean
  providerName: string
  /** Instruments not asked about because of the cap, so the UI can say so. */
  omitted: number
  /** Named when a provider call failed, so a short feed explains itself. */
  degradedReason: string | null
}

const EMPTY = (providerName: string, reason: string | null): NewsBundle => ({
  articles: [],
  covered: false,
  providerName,
  omitted: 0,
  degradedReason: reason,
})

/**
 * Turns a provider's raw article into a classified one.
 *
 * The single place a `NewsArticle` comes into existence, which is what makes the classification
 * rules impossible to bypass.
 */
function normalize(raw: RawArticle, provider: string, now: Date): NewsArticle | null {
  if (!isPresentable(raw, now)) return null

  const { sentiment, method } = classifySentiment(raw.title, raw.summary)

  return {
    dedupeKey: dedupeKeyFor(raw),
    title: raw.title.trim(),
    // Never generated. A provider that supplied no summary yields a headline and nothing more.
    summary: raw.summary?.trim() || null,
    url: raw.url,
    source: raw.source.trim(),
    publishedAt: raw.publishedAt,
    fetchedAt: now.toISOString(),
    language: raw.language,
    market: raw.market,
    category: classifyCategory(raw.title, raw.summary),
    symbols: raw.symbols.map((symbol) => symbolKey(symbol, raw.market ?? "US")),
    sentiment,
    sentimentMethod: method,
    provider,
  }
}

export const loadNews = cache(
  async (
    portfolioId: string | null,
    options: { scope?: FeedScope; sort?: NewsSort; category?: NewsCategory; limit?: number } = {},
  ): Promise<NewsBundle> => {
    const provider = getNewsProvider()
    const now = new Date()

    if (provider.capabilities.markets.length === 0) {
      return EMPTY(provider.name, "This deployment has no news provider configured.")
    }

    const scope = options.scope ?? "PORTFOLIO"
    const limit = Math.min(options.limit ?? 40, 100)

    const [view, watched] = await Promise.all([
      portfolioId ? loadPortfolioView(portfolioId).catch(() => null) : Promise.resolve(null),
      watchedSymbols().catch(() => new Set<string>()),
    ])

    const held = new Set(
      (view?.holdings ?? [])
        .filter((holding) => holding.quantity > 0)
        .map((holding) => symbolKey(holding.symbol, holding.market)),
    )

    // Held before watched, so the instrument cap drops what the reader merely follows first.
    const wanted: string[] =
      scope === "WATCHLIST" ? [...watched] : scope === "MARKET" ? [] : [...held, ...watched]

    const instruments: Array<{ symbol: string; market: MarketId }> = []
    const seen = new Set<string>()
    for (const key of wanted) {
      const [market, symbol] = key.split(":")
      if (!market || !symbol || seen.has(key)) continue
      if (!coversMarket(market as MarketId)) continue
      seen.add(key)
      instruments.push({ symbol, market: market as MarketId })
    }
    const asked = instruments.slice(0, MAX_FEED_INSTRUMENTS)

    const markets = new Set<string>([...held, ...watched].map((key) => key.split(":")[0]))
    if (markets.size === 0) markets.add("US")

    const results = await Promise.allSettled([
      ...asked.map((instrument) =>
        provider.bySymbol(instrument.symbol, instrument.market, { limit: 10 }),
      ),
      // Market context, always: a reader with no holdings still gets a usable feed.
      ...[...markets]
        .filter((market) => coversMarket(market as MarketId))
        .map((market) => provider.byMarket(market as MarketId, { limit: 10 })),
    ])

    const raw: RawArticle[] = []
    let failures = 0
    for (const result of results) {
      if (result.status === "fulfilled") raw.push(...result.value)
      else {
        failures += 1
        logger.warn("news.fetch_failed", describeError(result.reason))
      }
    }

    const normalized = raw
      .map((item) => normalize(item, provider.name, now))
      .filter((item): item is NewsArticle => item !== null)

    const deduped = dedupeArticles(normalized)

    const context: RelevanceContext = {
      held,
      watched,
      markets,
      // Event matching is wired where corporate events are already loaded; an empty set here means
      // the event term contributes nothing rather than a wrong bonus.
      eventSymbols: new Set<string>(),
    }

    const filtered = options.category
      ? deduped.filter((item) => item.category === options.category)
      : deduped

    const ordered = sortArticles(filtered, options.sort ?? "RELEVANCE", context, now)

    return {
      articles: ordered.slice(0, limit).map((item) => ({
        ...item,
        relation: item.symbols.some((s) => held.has(s))
          ? ("HELD" as const)
          : item.symbols.some((s) => watched.has(s))
            ? ("WATCHED" as const)
            : ("MARKET" as const),
        events: [] as EventLink[],
        age: ageOf(item.publishedAt, now),
      })),
      covered: true,
      providerName: provider.name,
      omitted: Math.max(0, instruments.length - asked.length),
      /*
       * A partial failure says so rather than presenting a short feed as a complete one — the
       * difference between "quiet news day" and "half our sources are down".
       */
      degradedReason:
        failures > 0
          ? `${failures} news request${failures === 1 ? "" : "s"} failed, so this feed may be incomplete.`
          : null,
    }
  },
)

/**
 * News for one instrument, with any corporate events it plausibly relates to.
 *
 * The event link is stated with a confidence and never changes the event: phase 17 owns those, and
 * this only says the two are probably about the same thing.
 */
export const loadSymbolNews = cache(
  async (
    symbol: string,
    market: MarketId,
    events: readonly { symbol: string; market: string; type: string; date: string | null }[] = [],
  ): Promise<NewsBundle> => {
    const provider = getNewsProvider()
    const now = new Date()

    if (!coversMarket(market)) {
      return EMPTY(
        provider.name,
        provider.capabilities.markets.length === 0
          ? "This deployment has no news provider configured."
          : `Stockly's news provider does not cover ${market}.`,
      )
    }

    let raw: RawArticle[] = []
    let degraded: string | null = null
    try {
      raw = await provider.bySymbol(symbol, market, { limit: 15 })
    } catch (error) {
      logger.warn("news.symbol_fetch_failed", { symbol, market, ...describeError(error) })
      degraded = "News could not be loaded for this instrument."
    }

    const articles = dedupeArticles(
      raw
        .map((item) => normalize(item, provider.name, now))
        .filter((item): item is NewsArticle => item !== null),
    ).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))

    return {
      articles: articles.map((item) => ({
        ...item,
        relation: "MARKET" as const,
        events: linkToEvents(item, events),
        age: ageOf(item.publishedAt, now),
      })),
      covered: true,
      providerName: provider.name,
      omitted: 0,
      degradedReason: degraded,
    }
  },
)
