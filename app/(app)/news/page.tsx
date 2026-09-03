import type { Metadata } from "next"
import Link from "next/link"
import { NewsList } from "@/features/news/components/news-list"
import { loadNews, type FeedScope } from "@/features/news/loader"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { NEWS_CATEGORIES, CATEGORY_LABELS, NEWS_SORTS, type NewsCategory, type NewsSort } from "@/domain/news"

export const metadata: Metadata = { title: "News" }

/** The nonce-based CSP needs a server-rendered response; a prerendered page carries no nonce. */
export const dynamic = "force-dynamic"

const SCOPES: Array<{ key: FeedScope; label: string }> = [
  { key: "PORTFOLIO", label: "Portfolio" },
  { key: "WATCHLIST", label: "Watchlist" },
  { key: "MARKET", label: "Market" },
]

const SORT_LABELS: Record<NewsSort, string> = {
  RELEVANCE: "Most relevant",
  NEWEST: "Newest",
  OLDEST: "Oldest",
}

/**
 * The news feed.
 *
 * Filters are links rather than client state: each combination is a URL somebody can share or
 * bookmark, the server does the filtering, and there is no feed in a client store to fall out of
 * step with what was rendered.
 */
export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; scope?: string; sort?: string; category?: string }>
}) {
  const params = await searchParams
  const { active } = await resolveActivePortfolio(params.p)

  const scope = (SCOPES.find((s) => s.key === params.scope)?.key ?? "PORTFOLIO") as FeedScope
  const sort = (NEWS_SORTS as readonly string[]).includes(params.sort ?? "")
    ? (params.sort as NewsSort)
    : "RELEVANCE"
  const category = (NEWS_CATEGORIES as readonly string[]).includes(params.category ?? "")
    ? (params.category as NewsCategory)
    : undefined

  const data = await loadNews(active?.id ?? null, { scope, sort, category })

  const href = (next: Record<string, string | undefined>) => {
    const query = new URLSearchParams()
    if (active) query.set("p", active.id)
    const merged = { scope, sort, category, ...next }
    for (const [key, value] of Object.entries(merged)) if (value) query.set(key, value)
    return `/news?${query.toString()}`
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">News</h1>
        <p className="text-muted-foreground text-sm">
          Context around what you hold and watch. Stockly does not interpret it.
        </p>
      </header>

      <nav aria-label="Feed" className="flex flex-wrap gap-1">
        {SCOPES.map((option) => (
          <Link
            key={option.key}
            href={href({ scope: option.key })}
            aria-current={option.key === scope ? "page" : undefined}
            className={`rounded-md border px-3 py-1 text-xs pointer-coarse:min-h-11 pointer-coarse:px-4 ${
              option.key === scope ? "bg-foreground text-background" : "hover:bg-muted"
            }`}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap gap-1">
        <Link
          href={href({ category: undefined })}
          aria-current={category === undefined ? "true" : undefined}
          className={`rounded-md border px-2.5 py-1 text-xs pointer-coarse:min-h-11 pointer-coarse:px-3 ${
            category === undefined ? "bg-muted font-medium" : "hover:bg-muted"
          }`}
        >
          All
        </Link>
        {NEWS_CATEGORIES.map((option) => (
          <Link
            key={option}
            href={href({ category: option })}
            aria-current={option === category ? "true" : undefined}
            className={`rounded-md border px-2.5 py-1 text-xs pointer-coarse:min-h-11 pointer-coarse:px-3 ${
              option === category ? "bg-muted font-medium" : "hover:bg-muted"
            }`}
          >
            {CATEGORY_LABELS[option]}
          </Link>
        ))}
      </div>

      <nav aria-label="Sort" className="text-muted-foreground flex flex-wrap gap-3 text-xs">
        {NEWS_SORTS.map((option) => (
          <Link
            key={option}
            href={href({ sort: option })}
            aria-current={option === sort ? "true" : undefined}
            className={option === sort ? "text-foreground font-medium" : "hover:text-foreground"}
          >
            {SORT_LABELS[option]}
          </Link>
        ))}
      </nav>

      <NewsList
        data={data}
        title={SCOPES.find((s) => s.key === scope)?.label ?? "News"}
        description={active ? active.name : undefined}
      />
    </div>
  )
}
