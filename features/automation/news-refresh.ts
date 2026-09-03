import "server-only"

import {
  classifyCategory,
  classifySentiment,
  dedupeArticles,
  dedupeKeyFor,
  isPresentable,
  type NewsArticle,
} from "@/domain/news"
import { MARKET_REGISTRY, symbolKey, type MarketId } from "@/domain/market"
import { getNewsProvider } from "@/services/news"
import type { RawArticle } from "@/services/news"
import { describeError, logger } from "@/lib/log"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

/**
 * The scheduled news refresh.
 *
 * Four properties, each a line of code below:
 *
 * - **Idempotent.** `dedupe_key` is the table's primary key, so a re-run upserts the same rows.
 *   Running the job three times produces the same table as running it once — the guarantee is the
 *   database's, not a check in this file.
 * - **Bounded.** `MAX_NEWS_INSTRUMENTS` per run, drawn from what users hold and watch.
 * - **Shared.** One fetch of NVDA's coverage serves everybody holding it, which is why the tables
 *   have no `user_id`.
 * - **Creates nothing a user owns.** It writes two reference tables and never a transaction, a
 *   holding or a corporate event. **News changes no figure anywhere.**
 *
 * Retention runs here too: article metadata accumulates forever otherwise, and a feed nobody reads
 * past a month is not worth an unbounded table.
 */

export const MAX_NEWS_INSTRUMENTS = 30

/** Beyond this an article is deleted. A news feed is not an archive. */
export const NEWS_RETENTION_DAYS = 90

export type NewsRefresh = {
  instruments: number
  fetched: number
  /** How many the dedupe key collapsed — the same story from several sources. */
  deduplicated: number
  /** How many were dropped for having no verifiable source, link or date. */
  rejected: number
  written: number
  deleted: number
  failed: number
  skipped: boolean
}

/** Everything held or watched, across all users. Reference data, fetched once for everybody. */
async function instrumentsToRefresh(
  supabase: SupabaseClient<Database>,
): Promise<Array<{ symbol: string; market: MarketId }>> {
  const [transactions, watchlist] = await Promise.all([
    supabase.from("transactions").select("symbol, market").limit(2_000),
    supabase.from("watchlist_items").select("symbol, market").limit(1_000),
  ])

  const seen = new Set<string>()
  const out: Array<{ symbol: string; market: MarketId }> = []
  for (const row of [...(transactions.data ?? []), ...(watchlist.data ?? [])]) {
    const market = (row.market ?? "US") as MarketId
    if (!(market in MARKET_REGISTRY)) continue
    const key = symbolKey(row.symbol, market)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ symbol: row.symbol, market })
  }
  return out.slice(0, MAX_NEWS_INSTRUMENTS)
}

export async function refreshNews(supabase: SupabaseClient<Database>): Promise<NewsRefresh> {
  const provider = getNewsProvider()
  const now = new Date()
  const run: NewsRefresh = {
    instruments: 0,
    fetched: 0,
    deduplicated: 0,
    rejected: 0,
    written: 0,
    deleted: 0,
    failed: 0,
    skipped: false,
  }

  if (provider.capabilities.markets.length === 0) {
    logger.info("news.refresh_skipped", { reason: "no_provider" })
    return { ...run, skipped: true }
  }

  const instruments = await instrumentsToRefresh(supabase)
  run.instruments = instruments.length

  const raw: RawArticle[] = []

  for (const instrument of instruments) {
    if (!provider.capabilities.markets.includes(instrument.market)) continue
    try {
      raw.push(...(await provider.bySymbol(instrument.symbol, instrument.market, { limit: 10 })))
    } catch (error) {
      // One instrument's failure costs that instrument, never the run.
      logger.warn("news.refresh_symbol_failed", {
        symbol: instrument.symbol,
        market: instrument.market,
        ...describeError(error),
      })
      run.failed += 1
    }
  }

  for (const market of new Set(instruments.map((i) => i.market))) {
    try {
      raw.push(...(await provider.byMarket(market, { limit: 10 })))
    } catch (error) {
      logger.warn("news.refresh_market_failed", { market, ...describeError(error) })
      run.failed += 1
    }
  }

  run.fetched = raw.length

  /*
   * Classified here, exactly as the loader does it, using the same domain functions.
   *
   * An article that cannot be presented — no real title, no named source, no safe https link, or a
   * publication date in the future — is **dropped, not repaired**. There is nothing to repair it
   * from, and a rumour with a fabricated link is worse than a shorter feed.
   */
  const normalized: NewsArticle[] = []
  for (const item of raw) {
    if (!isPresentable(item, now)) {
      run.rejected += 1
      continue
    }
    const { sentiment, method } = classifySentiment(item.title, item.summary)
    normalized.push({
      dedupeKey: dedupeKeyFor(item),
      title: item.title.trim(),
      summary: item.summary?.trim() || null,
      url: item.url,
      source: item.source.trim(),
      publishedAt: item.publishedAt,
      fetchedAt: now.toISOString(),
      language: item.language,
      market: item.market,
      category: classifyCategory(item.title, item.summary),
      symbols: item.symbols.map((symbol) => symbolKey(symbol, item.market ?? "US")),
      sentiment,
      sentimentMethod: method,
      provider: provider.name,
    })
  }

  const articles = dedupeArticles(normalized)
  run.deduplicated = normalized.length - articles.length

  if (articles.length > 0) {
    // One upsert, keyed on the primary key. Re-running the job rewrites the same rows.
    const { error } = await supabase.from("news_articles").upsert(
      articles.map((article) => ({
        dedupe_key: article.dedupeKey,
        title: article.title,
        summary: article.summary,
        url: article.url,
        source: article.source,
        published_at: article.publishedAt,
        fetched_at: article.fetchedAt,
        language: article.language,
        market: article.market,
        category: article.category,
        sentiment: article.sentiment,
        sentiment_method: article.sentimentMethod,
        provider: article.provider,
      })),
      { onConflict: "dedupe_key" },
    )

    if (error) {
      logger.warn("news.write_failed", { code: error.code })
      run.failed += 1
    } else {
      run.written = articles.length

      const links = articles.flatMap((article) =>
        article.symbols.map((key) => {
          const [market, symbol] = key.split(":")
          return { dedupe_key: article.dedupeKey, symbol, market }
        }),
      )
      if (links.length > 0) {
        const { error: linkError } = await supabase
          .from("news_article_symbols")
          .upsert(links, { onConflict: "dedupe_key,market,symbol" })
        if (linkError) logger.warn("news.link_write_failed", { code: linkError.code })
      }
    }
  }

  /*
   * Retention.
   *
   * Metadata is small but unbounded, and a feed nobody reads past a quarter is not worth keeping.
   * The symbol links cascade with the article, so this is one delete.
   */
  const cutoff = new Date(now.getTime() - NEWS_RETENTION_DAYS * 86_400_000).toISOString()
  const { error: deleteError, count } = await supabase
    .from("news_articles")
    .delete({ count: "exact" })
    .lt("published_at", cutoff)
  if (deleteError) logger.warn("news.retention_failed", { code: deleteError.code })
  else run.deleted = count ?? 0

  logger.info("news.refresh_completed", {
    instruments: run.instruments,
    fetched: run.fetched,
    deduplicated: run.deduplicated,
    rejected: run.rejected,
    written: run.written,
    deleted: run.deleted,
    failed: run.failed,
  })
  return run
}
