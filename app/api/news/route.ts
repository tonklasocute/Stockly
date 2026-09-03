import { NEWS_CATEGORIES, NEWS_SORTS, type NewsCategory, type NewsSort } from "@/domain/news"
import { ApiError, enforceRateLimit, guarded, ok } from "@/lib/api"
import { loadNews, type FeedScope } from "@/features/news/loader"

/**
 * The news feed.
 *
 * One endpoint rather than `/portfolios/:id/news`, `/watchlists/:id/news` and `/market-news`: all
 * three are the same query with a different instrument set, and three routes would be three copies
 * of the ranking.
 *
 * **The response says why an article is in the feed — `HELD`, `WATCHED` or `MARKET` — and nothing
 * about the size of the position behind it.** The reader's holdings are used to rank, on the
 * server, under their own session, and never leave it.
 */
const SCOPES: readonly FeedScope[] = ["PORTFOLIO", "WATCHLIST", "MARKET"]

export async function GET(request: Request) {
  return guarded(async (userId) => {
    const params = new URL(request.url).searchParams

    // Each call can reach the provider once per instrument, bounded by MAX_FEED_INSTRUMENTS.
    enforceRateLimit(`news:${userId}`, 30, 60)

    const scope = params.get("scope") ?? "PORTFOLIO"
    if (!SCOPES.includes(scope as FeedScope)) {
      throw new ApiError("VALIDATION_ERROR", "That feed does not exist.")
    }

    const sort = params.get("sort") ?? "RELEVANCE"
    if (!(NEWS_SORTS as readonly string[]).includes(sort)) {
      throw new ApiError("VALIDATION_ERROR", "That sort order is not one Stockly offers.")
    }

    const category = params.get("category") ?? undefined
    if (category !== undefined && !(NEWS_CATEGORIES as readonly string[]).includes(category)) {
      throw new ApiError("VALIDATION_ERROR", "That category does not exist.")
    }

    const limit = Number(params.get("limit") ?? 40)

    return ok(
      await loadNews(params.get("portfolioId"), {
        scope: scope as FeedScope,
        sort: sort as NewsSort,
        category: category as NewsCategory | undefined,
        limit: Number.isFinite(limit) ? limit : 40,
      }),
    )
  })
}
