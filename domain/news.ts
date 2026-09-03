import type { MarketId } from "./market"

/**
 * News: context around a holding, never a reason to trade one.
 *
 * The rules this module enforces, in the order they matter:
 *
 * 1. **Nothing is fabricated.** No headline, summary, source or URL is ever constructed here. An
 *    article whose source or link cannot be verified is not presentable, and `isPresentable` is the
 *    gate — a story with no attributable origin is a rumour, and Stockly does not print rumours.
 * 2. **News is contextual information and never financial truth.** No figure in an article reaches
 *    a portfolio. `news-invariants.test.ts` ingests a thousand articles and asserts holdings, cost
 *    basis and P&L are byte-identical.
 * 3. **Sentiment describes tone, never direction.** "Negative" is a statement about how an article
 *    is written, not a claim about where a price is going, and the vocabulary check enforces it.
 * 4. **`publishedAt` and `fetchedAt` are different facts** and neither substitutes for the other.
 *
 * Pure: no client, no network, no framework import.
 */

// ---------------------------------------------------------------- categories

/**
 * The taxonomy.
 *
 * Deliberately overlaps `EventType` in name only where the concepts genuinely coincide — an
 * EARNINGS *article* and an EARNINGS *event* are different objects about the same subject, and
 * `linkToEvents` is what relates them. There is no second event model here.
 */
export const NEWS_CATEGORIES = [
  "EARNINGS",
  "DIVIDEND",
  "CORPORATE",
  "M_AND_A",
  "MANAGEMENT",
  "PRODUCT",
  "REGULATION",
  "LEGAL",
  "MACRO",
  "MARKET",
  "SECTOR",
  "ANALYST",
  "OTHER",
] as const
export type NewsCategory = (typeof NEWS_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<NewsCategory, string> = {
  EARNINGS: "Earnings",
  DIVIDEND: "Dividend",
  CORPORATE: "Corporate action",
  M_AND_A: "Mergers & acquisitions",
  MANAGEMENT: "Management",
  PRODUCT: "Product",
  REGULATION: "Regulation",
  LEGAL: "Legal",
  MACRO: "Macro",
  MARKET: "Market",
  SECTOR: "Sector",
  ANALYST: "Analyst commentary",
  OTHER: "Other",
}

// ---------------------------------------------------------------- sentiment

/**
 * The **tone** of an article, and nothing more.
 *
 * `UNKNOWN` is the default and the honest answer for most articles. A rule-based classifier reading
 * headlines is right often enough to be useful and wrong often enough that pretending to certainty
 * would be misleading — so the bar for a non-unknown answer is deliberately high, and the method is
 * always reported beside the label.
 *
 * **It is never mapped to an action.** Positive does not mean buy. `news.test.ts` asserts that no
 * sentence this module produces contains the forbidden vocabulary.
 */
export const SENTIMENTS = ["POSITIVE", "NEUTRAL", "NEGATIVE", "MIXED", "UNKNOWN"] as const
export type Sentiment = (typeof SENTIMENTS)[number]

export const SENTIMENT_LABELS: Record<Sentiment, string> = {
  POSITIVE: "Positive tone",
  NEUTRAL: "Neutral tone",
  NEGATIVE: "Negative tone",
  MIXED: "Mixed tone",
  UNKNOWN: "Tone not classified",
}

export const SENTIMENT_METHODS = ["RULE_BASED", "PROVIDER", "NONE"] as const
export type SentimentMethod = (typeof SENTIMENT_METHODS)[number]

/**
 * The one sentence that must appear wherever sentiment is shown.
 *
 * Written to close the inference a reader makes automatically.
 */
export const SENTIMENT_DISCLAIMER =
  "Tone describes how an article is written, not what a price will do."

// ---------------------------------------------------------------- the article

export type NewsArticle = {
  /** Stable across refetches — see `dedupeKeyFor`. */
  dedupeKey: string
  title: string
  /** The provider's own summary. **Never generated here** when one is absent. */
  summary: string | null
  /** Verified https URL. An article without one is not presentable. */
  url: string
  /** The publication's name, as the provider reported it. */
  source: string
  /** When the publication published it. */
  publishedAt: string
  /** When Stockly fetched it. A different fact, and never a substitute. */
  fetchedAt: string
  language: string | null
  market: MarketId | null
  category: NewsCategory
  /** Instruments the article is about, as `symbolKey`s. */
  symbols: string[]
  sentiment: Sentiment
  sentimentMethod: SentimentMethod
  /** Provider name, so a correction can be traced. */
  provider: string
}

// ---------------------------------------------------------------- URL safety

/**
 * Whether a link can be put in front of a user.
 *
 * Security-critical, and the reason it lives in the domain rather than in a component: a provider's
 * response is untrusted input, and a URL from one reaches an `<a href>`. The rules:
 *
 * - **https only.** Not http — a news link is not worth a downgrade — and emphatically not
 *   `javascript:`, `data:` or `vbscript:`, each of which executes when clicked.
 * - **A real host**, so a relative or malformed URL cannot become a same-origin navigation that
 *   looks like part of Stockly.
 * - **Bounded**, because an unbounded string in an attribute is a payload.
 *
 * Stockly never proxies or redirects through its own origin, so there is no open-redirect surface
 * to protect: the href is the provider's URL or the article is not shown.
 */
export const MAX_URL_LENGTH = 2_000

export function isSafeArticleUrl(url: string): boolean {
  if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL_LENGTH) return false

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  // An allowlist, not a denylist: a scheme nobody thought of is refused rather than permitted.
  if (parsed.protocol !== "https:") return false
  if (parsed.hostname.length === 0) return false
  // Credentials in a URL are a phishing shape ("https://apple.com@evil.test").
  if (parsed.username.length > 0 || parsed.password.length > 0) return false
  return true
}

/**
 * The URL used for de-duplication.
 *
 * Tracking parameters differ between syndications of the identical article, so they are stripped;
 * everything else about the URL is left alone, because a query parameter can be the article's
 * identity. Returns null for a URL that is not safe, so an unusable link cannot seed a key.
 */
const TRACKING_PARAMS = [
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "fbclid", "gclid", "ref", "ref_src", "cmpid", "partner",
]

export function canonicalUrl(url: string): string | null {
  if (!isSafeArticleUrl(url)) return null
  const parsed = new URL(url)
  for (const param of TRACKING_PARAMS) parsed.searchParams.delete(param)
  parsed.hash = ""
  // Host casing and a trailing slash are not identity.
  parsed.hostname = parsed.hostname.toLowerCase()
  const path = parsed.pathname.replace(/\/+$/, "")
  return `${parsed.origin}${path}${parsed.search}`
}

// ---------------------------------------------------------------- normalization

/**
 * A title reduced to its identity, for comparison only.
 *
 * Never displayed — the original is what a user reads. Lowercased, punctuation and whitespace
 * collapsed, so "Apple's Q3 Results Beat" and "Apple's Q3 results beat!" are recognised as one
 * story.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .slice(0, 200)
}

/**
 * The de-duplication key.
 *
 * **Canonical URL first**, because it is the strongest identity an article has: two providers
 * syndicating the same story point at the same page. Only when a URL cannot be canonicalised does
 * this fall back to the title and the publication day — and never to the title alone, which would
 * collide across "Market wrap" published every morning by the same outlet.
 *
 * The day rather than the timestamp: providers disagree about publication minutes for the same
 * article, and an hour of drift must not create a second row.
 */
export function dedupeKeyFor(input: {
  url: string
  title: string
  source: string
  publishedAt: string
}): string {
  const canonical = canonicalUrl(input.url)
  if (canonical) return `url:${canonical}`
  const day = input.publishedAt.slice(0, 10)
  return `title:${input.source.toLowerCase()}:${normalizeTitle(input.title)}:${day}`
}

/**
 * Whether an article can be shown as a verified story.
 *
 * The gate that stops a rumour becoming a headline: a presentable article has a real title, a named
 * source, a safe URL and a publication date that is not in the future. Anything else is dropped —
 * not repaired, because there is nothing to repair it from.
 */
export function isPresentable(article: {
  title: string
  url: string
  source: string
  publishedAt: string
}, now: Date): boolean {
  if (article.title.trim().length < 3) return false
  if (article.source.trim().length === 0) return false
  if (!isSafeArticleUrl(article.url)) return false

  const published = Date.parse(article.publishedAt)
  if (Number.isNaN(published)) return false
  /*
   * A publication date in the future is a provider bug or a timezone error, and an article dated
   * tomorrow sorts above everything real forever. A little tolerance for clock skew, then refused.
   */
  if (published > now.getTime() + 6 * 60 * 60 * 1_000) return false
  return true
}

/**
 * Collapses duplicates, keeping the **earliest publication** of each story.
 *
 * The earliest, not the latest: a syndicated copy published hours after the original is the same
 * news, and dating it later would push a story that broke this morning above one that broke since.
 * The article kept kept is the one whose source published first.
 */
export function dedupeArticles(articles: readonly NewsArticle[]): NewsArticle[] {
  const byKey = new Map<string, NewsArticle>()
  for (const article of articles) {
    const existing = byKey.get(article.dedupeKey)
    if (!existing || article.publishedAt < existing.publishedAt) {
      byKey.set(article.dedupeKey, article)
    }
  }
  return [...byKey.values()]
}

// ---------------------------------------------------------------- classification

/**
 * Keyword rules, deterministic and inspectable.
 *
 * Not a model: a category a user cannot predict is a category they cannot filter by. Ordered, and
 * the first match wins — `M_AND_A` before `CORPORATE` because an acquisition is a corporate action
 * and the more specific label is the useful one.
 */
const CATEGORY_RULES: ReadonlyArray<{ category: NewsCategory; patterns: readonly RegExp[] }> = [
  { category: "EARNINGS", patterns: [/\bearnings\b/i, /\bquarterly results\b/i, /\bq[1-4]\s+(?:results|report)\b/i, /\brevenue (?:rose|fell|beat|missed)\b/i] },
  { category: "DIVIDEND", patterns: [/\bdividend\b/i, /\bex-dividend\b/i, /\bpayout\b/i, /\bXD\b/] },
  { category: "M_AND_A", patterns: [/\bacquisit/i, /\bacquires?\b/i, /\bmerger\b/i, /\btakeover\b/i, /\bbuyout\b/i] },
  { category: "MANAGEMENT", patterns: [/\bchief executive\b/i, /\bCEO\b/, /\bCFO\b/, /\bresigns?\b/i, /\bappoint(?:s|ed|ment)\b/i] },
  { category: "REGULATION", patterns: [/\bregulator/i, /\bSEC\b/, /\bantitrust\b/i, /\bcompliance\b/i] },
  { category: "LEGAL", patterns: [/\blawsuit\b/i, /\bsues?\b/i, /\bcourt\b/i, /\bsettlement\b/i] },
  { category: "ANALYST", patterns: [/\banalyst\b/i, /\bprice target\b/i, /\bupgrade[sd]?\b/i, /\bdowngrade[sd]?\b/i] },
  { category: "MACRO", patterns: [/\binflation\b/i, /\binterest rates?\b/i, /\bcentral bank\b/i, /\bGDP\b/, /\bunemployment\b/i, /\bFederal Reserve\b/i] },
  { category: "PRODUCT", patterns: [/\blaunch(?:es|ed)?\b/i, /\bunveil/i, /\bnew product\b/i] },
  { category: "CORPORATE", patterns: [/\bsplit\b/i, /\brights offering\b/i, /\bbuyback\b/i, /\bshare repurchase\b/i] },
  { category: "MARKET", patterns: [/\bindex\b/i, /\bmarket (?:wrap|close|open)\b/i, /\bS&P 500\b/i, /\bNasdaq\b/i, /\bSET index\b/i] },
]

/** The category, from the title and summary. `OTHER` when no rule matches — never a guess. */
export function classifyCategory(title: string, summary: string | null): NewsCategory {
  const text = `${title} ${summary ?? ""}`
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.category
  }
  return "OTHER"
}

/**
 * Tone, by rule.
 *
 * The threshold is deliberately high: a headline needs **two or more** signals in one direction and
 * none in the other before it is labelled, and anything else is `UNKNOWN`. Most news genuinely is
 * unclassifiable from a headline, and saying so is more useful than a coin flip presented as
 * analysis.
 *
 * The vocabulary is about *what happened*, not about what to do — no rule looks for "buy", "sell",
 * "outperform" or a price target, because those are somebody's recommendation rather than the
 * article's tone.
 */
const POSITIVE_SIGNALS = [
  /\bbeat(?:s|ing)?\b/i, /\bsurge[sd]?\b/i, /\brecord (?:high|profit|revenue)\b/i, /\bgrew\b/i,
  /\bgrowth\b/i, /\bprofit rose\b/i, /\bexceed(?:s|ed)\b/i, /\bwins?\b/i, /\bapproval\b/i,
]
const NEGATIVE_SIGNALS = [
  /\bmiss(?:es|ed)\b/i, /\bplunge[sd]?\b/i, /\bslump(?:s|ed)?\b/i, /\bloss(?:es)?\b/i,
  /\bcuts?\b/i, /\blayoffs?\b/i, /\brecall\b/i, /\bprobe\b/i, /\blawsuit\b/i, /\bwarns?\b/i,
]

/** How many signals in one direction are needed before a tone is claimed. */
export const SENTIMENT_THRESHOLD = 2

export function classifySentiment(
  title: string,
  summary: string | null,
): { sentiment: Sentiment; method: SentimentMethod } {
  const text = `${title} ${summary ?? ""}`
  const positive = POSITIVE_SIGNALS.filter((pattern) => pattern.test(text)).length
  const negative = NEGATIVE_SIGNALS.filter((pattern) => pattern.test(text)).length

  if (positive >= SENTIMENT_THRESHOLD && negative >= SENTIMENT_THRESHOLD) {
    return { sentiment: "MIXED", method: "RULE_BASED" }
  }
  if (positive >= SENTIMENT_THRESHOLD && negative === 0) {
    return { sentiment: "POSITIVE", method: "RULE_BASED" }
  }
  if (negative >= SENTIMENT_THRESHOLD && positive === 0) {
    return { sentiment: "NEGATIVE", method: "RULE_BASED" }
  }
  // The honest default, and the common one.
  return { sentiment: "UNKNOWN", method: "NONE" }
}

// ---------------------------------------------------------------- freshness

export const NEWS_AGES = ["BREAKING", "RECENT", "OLDER"] as const
export type NewsAge = (typeof NEWS_AGES)[number]

/** Under an hour is breaking; under two days is recent. Named rather than inlined. */
export const NEWS_AGE_THRESHOLDS = { breakingMinutes: 60, recentHours: 48 } as const

/**
 * How old a story is, **from `publishedAt`** — never from when Stockly fetched it.
 *
 * A story published yesterday and fetched a minute ago is a day old, and labelling it fresh because
 * of the fetch would be the most misleading thing this module could do.
 */
export function ageOf(publishedAt: string, now: Date): NewsAge {
  const minutes = (now.getTime() - Date.parse(publishedAt)) / 60_000
  if (!Number.isFinite(minutes)) return "OLDER"
  if (minutes <= NEWS_AGE_THRESHOLDS.breakingMinutes) return "BREAKING"
  if (minutes <= NEWS_AGE_THRESHOLDS.recentHours * 60) return "RECENT"
  return "OLDER"
}

// ---------------------------------------------------------------- relevance

export const RELEVANCE_WEIGHTS = {
  /** The article names an instrument the reader holds. */
  heldSymbol: 100,
  /** It names one they watch. */
  watchedSymbol: 60,
  /** It matches a corporate event they have coming up. */
  eventMatch: 30,
  /** It is about a market they are invested in. */
  marketMatch: 10,
  /** Recency, at most this much. */
  recencyMax: 20,
} as const

export type RelevanceContext = {
  held: ReadonlySet<string>
  watched: ReadonlySet<string>
  markets: ReadonlySet<string>
  /** `symbolKey`s with an upcoming corporate event. */
  eventSymbols: ReadonlySet<string>
}

/**
 * How relevant an article is to one reader.
 *
 * **Deterministic and inspectable**, which is the requirement: a ranking a user cannot reason about
 * is a ranking they cannot trust. Every term is a named weight above, and the score is a sum — no
 * model, no opaque blend, and the same inputs always produce the same order.
 *
 * Recency is bounded so it cannot outweigh ownership: a week-old story about a holding still ranks
 * above a headline from ten minutes ago about a company the reader has never heard of.
 */
export function relevanceOf(
  article: Pick<NewsArticle, "symbols" | "market" | "publishedAt">,
  context: RelevanceContext,
  now: Date,
): number {
  let score = 0

  for (const symbol of article.symbols) {
    if (context.held.has(symbol)) score += RELEVANCE_WEIGHTS.heldSymbol
    else if (context.watched.has(symbol)) score += RELEVANCE_WEIGHTS.watchedSymbol
    if (context.eventSymbols.has(symbol)) score += RELEVANCE_WEIGHTS.eventMatch
  }

  if (article.market !== null && context.markets.has(article.market)) {
    score += RELEVANCE_WEIGHTS.marketMatch
  }

  const hours = (now.getTime() - Date.parse(article.publishedAt)) / 3_600_000
  if (Number.isFinite(hours) && hours >= 0) {
    // Decays to nothing across a week, and never exceeds its cap.
    score += Math.max(0, RELEVANCE_WEIGHTS.recencyMax * (1 - hours / 168))
  }

  return score
}

export const NEWS_SORTS = ["RELEVANCE", "NEWEST", "OLDEST"] as const
export type NewsSort = (typeof NEWS_SORTS)[number]

/** Sorts a feed. Ties break on publication time, then on the key, so the order is total and stable. */
export function sortArticles(
  articles: readonly NewsArticle[],
  sort: NewsSort,
  context: RelevanceContext,
  now: Date,
): NewsArticle[] {
  const copy = [...articles]
  if (sort === "NEWEST") return copy.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  if (sort === "OLDEST") return copy.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt))

  return copy.sort((a, b) => {
    const difference = relevanceOf(b, context, now) - relevanceOf(a, context, now)
    if (difference !== 0) return difference
    const byDate = b.publishedAt.localeCompare(a.publishedAt)
    return byDate !== 0 ? byDate : a.dedupeKey.localeCompare(b.dedupeKey)
  })
}

// ---------------------------------------------------------------- event linking

export const MATCH_CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const
export type MatchConfidence = (typeof MATCH_CONFIDENCES)[number]

/** How close an article has to be to an event's date to be considered about it. */
export const EVENT_MATCH_WINDOW_DAYS = 7

export type EventLink = {
  symbol: string
  eventType: string
  eventDate: string
  confidence: MatchConfidence
}

/**
 * Relates an article to a corporate event, with a stated confidence.
 *
 * **The event remains the source of truth.** A linked article never changes an event's date, type
 * or existence — phase 17 owns those, and this only says "these two are probably about the same
 * thing". A link that cannot be defended is not made.
 *
 * The confidence ladder is the whole design:
 *
 *   HIGH    same symbol, matching category, within the window
 *   MEDIUM  same symbol, matching category, outside the window — or same symbol and date, no category
 *   LOW     never returned. A relationship that weak is not shown at all.
 */
export function linkToEvents(
  article: Pick<NewsArticle, "symbols" | "category" | "publishedAt">,
  events: readonly { symbol: string; market: string; type: string; date: string | null }[],
): EventLink[] {
  const links: EventLink[] = []

  for (const event of events) {
    if (event.date === null) continue
    const key = `${event.market}:${event.symbol}`
    if (!article.symbols.includes(key)) continue

    const days = Math.abs(
      (Date.parse(event.date) - Date.parse(article.publishedAt)) / 86_400_000,
    )
    if (!Number.isFinite(days)) continue

    const categoryMatches = event.type === article.category
    if (!categoryMatches) continue

    if (days <= EVENT_MATCH_WINDOW_DAYS) {
      links.push({ symbol: key, eventType: event.type, eventDate: event.date, confidence: "HIGH" })
    } else if (days <= EVENT_MATCH_WINDOW_DAYS * 4) {
      links.push({ symbol: key, eventType: event.type, eventDate: event.date, confidence: "MEDIUM" })
    }
    // Beyond that, nothing. An article a month from an event is not about it.
  }

  return links
}

// ---------------------------------------------------------------- notification text

/**
 * The text of a news notification.
 *
 * **Carries no portfolio figure**, ever. These reach a lock screen, which is not a private surface:
 * "New NVDA-related news is available" is safe, and "your NVDA position gained $4,283" is not. The
 * same rule phase 5 applied to price alerts.
 */
export function newsNotificationText(article: Pick<NewsArticle, "symbols" | "category">): string {
  const symbol = article.symbols[0]?.split(":")[1]
  if (!symbol) return "New market news is available."
  return `New ${symbol} news is available (${CATEGORY_LABELS[article.category].toLowerCase()}).`
}

/** Shown wherever news appears. */
export const NEWS_DISCLAIMER =
  "News is published by third parties and provided for context only. Stockly does not verify, " +
  "endorse or interpret it, and nothing here is investment advice."
