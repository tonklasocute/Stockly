import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import { Section } from "@/components/metric"
import { Newspaper, ExternalLink } from "lucide-react"
import {
  NEWS_DISCLAIMER,
  SENTIMENT_DISCLAIMER,
  type Sentiment,
} from "@/domain/news"
import type { NewsBundle } from "@/features/news/loader"
import { formatTime } from "@/lib/format"
import { appLocale } from "@/lib/i18n/server"
import { getTranslations } from "next-intl/server"

/**
 * A news feed.
 *
 * Four things it is careful about:
 *
 * 1. **Every article names its source and when it was published.** No headline appears without
 *    attribution — a story with no origin is a rumour.
 * 2. **`publishedAt` is what is shown**, never `fetchedAt`. A story published yesterday and fetched
 *    a minute ago is a day old.
 * 3. **Tone is never colour alone.** Every sentiment badge carries its word, and the disclaimer
 *    saying tone is not direction sits beneath the list.
 * 4. **Links leave Stockly explicitly** — `target="_blank"`, `rel="noopener noreferrer"`, and an
 *    icon plus screen-reader text saying so. The href is the provider's verified https URL;
 *    Stockly never proxies or redirects through its own origin, so there is no open-redirect
 *    surface.
 */
export async function NewsList({
  data,
  title = "News",
  description,
}: {
  data: NewsBundle
  title?: string
  description?: string
}) {
  const tn = await getTranslations("news")
  const tEnum = await getTranslations("enums")
  const locale = await appLocale()
  if (!data.covered) {
    return (
      <Section title={title}>
        <p className="text-muted-foreground text-sm">{data.degradedReason}</p>
        <p className="text-muted-foreground mt-2 text-xs">{tn("emptyBody")}</p>
      </Section>
    )
  }

  if (data.articles.length === 0) {
    return (
      <Section title={title} description={description}>
        <EmptyState
          icon={Newspaper}
          title={tn("empty")}
          description={
            data.degradedReason ??
            "Nothing has been published recently for the instruments in this feed."
          }
        />
      </Section>
    )
  }

  return (
    <Section title={title} description={description}>
      {/* A partial failure says so, rather than a short feed passing as a complete one. */}
      {data.degradedReason && (
        <p className="text-muted-foreground mb-3 text-xs">{data.degradedReason}</p>
      )}

      <ul className="divide-y">
        {data.articles.map((article) => (
          <li key={article.dedupeKey} className="py-3 first:pt-0">
            <article className="space-y-1.5">
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-2 font-medium underline-offset-4 hover:underline pointer-coarse:min-h-11"
              >
                <span className="min-w-0">{article.title}</span>
                <ExternalLink
                  className="text-muted-foreground mt-1 size-3.5 shrink-0"
                  aria-hidden
                />
                <span className="sr-only">(opens {article.source} in a new tab)</span>
              </a>

              {article.summary && (
                <p className="text-muted-foreground text-sm">{article.summary}</p>
              )}

              <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {/* Source and time, always. */}
                <span className="font-medium">{article.source}</span>
                <time dateTime={article.publishedAt}>{formatTime(article.publishedAt, locale)}</time>
                {article.age === "BREAKING" && <Badge variant="outline">{tn("justPublished")}</Badge>}
                <span>{tEnum(`newsCategory.${article.category}`)}</span>
                {article.relation !== "MARKET" && (
                  <Badge variant={article.relation === "HELD" ? "outline" : "secondary"}>
                    {article.relation === "HELD" ? "Held" : "Watching"}
                  </Badge>
                )}
                <SentimentBadge sentiment={article.sentiment} />
                {article.events.map((link) => (
                  <span key={`${link.symbol}-${link.eventDate}`}>
                    Related to a {link.eventType.toLowerCase()} event on {link.eventDate}
                    {link.confidence === "MEDIUM" ? " (possible match)" : ""}
                  </span>
                ))}
              </div>
            </article>
          </li>
        ))}
      </ul>

      {data.omitted > 0 && (
        <p className="text-muted-foreground mt-3 text-xs">
          {data.omitted} further instrument{data.omitted === 1 ? "" : "s"} were not checked, to keep
          this page within the provider&apos;s request budget.
        </p>
      )}

      <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
        {NEWS_DISCLAIMER} {SENTIMENT_DISCLAIMER}
      </p>
    </Section>
  )
}

/**
 * Tone, as a word.
 *
 * `UNKNOWN` renders nothing at all rather than a badge saying "unknown" on most of the feed — the
 * absence is the message, and the disclaimer under the list explains what a present badge means.
 * Never colour alone: the label is the content.
 */
async function SentimentBadge({ sentiment }: { sentiment: Sentiment }) {
  const tEnum = await getTranslations("enums")
  if (sentiment === "UNKNOWN") return null
  return <Badge variant="secondary">{tEnum(`sentiment.${sentiment}`)}</Badge>
}
