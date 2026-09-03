import { describe, expect, it } from "vitest"
import {
  ageOf,
  canonicalUrl,
  CATEGORY_LABELS,
  classifyCategory,
  classifySentiment,
  dedupeArticles,
  dedupeKeyFor,
  EVENT_MATCH_WINDOW_DAYS,
  isPresentable,
  isSafeArticleUrl,
  linkToEvents,
  MAX_URL_LENGTH,
  NEWS_CATEGORIES,
  NEWS_DISCLAIMER,
  newsNotificationText,
  normalizeTitle,
  relevanceOf,
  RELEVANCE_WEIGHTS,
  SENTIMENT_DISCLAIMER,
  SENTIMENT_LABELS,
  SENTIMENTS,
  sortArticles,
  type NewsArticle,
  type RelevanceContext,
} from "./news"
import { FORBIDDEN_INSIGHT_PATTERNS } from "./insights"

const NOW = new Date("2026-09-03T12:00:00Z")

const article = (overrides: Partial<NewsArticle> = {}): NewsArticle => ({
  dedupeKey: "url:https://example.test/a",
  title: "Company reports quarterly results",
  summary: null,
  url: "https://example.test/a",
  source: "Example Wire",
  publishedAt: "2026-09-03T09:00:00.000Z",
  fetchedAt: "2026-09-03T11:00:00.000Z",
  language: "en",
  market: "US",
  category: "EARNINGS",
  symbols: ["US:NVDA"],
  sentiment: "UNKNOWN",
  sentimentMethod: "NONE",
  provider: "mock",
  ...overrides,
})

describe("URL safety", () => {
  it("accepts an ordinary https link", () => {
    expect(isSafeArticleUrl("https://reuters.test/article/123")).toBe(true)
  })

  it("refuses every scheme that executes when clicked", () => {
    // The reason this lives in the domain: a provider response is untrusted input and its URL
    // reaches an href.
    expect(isSafeArticleUrl("javascript:alert(1)")).toBe(false)
    expect(isSafeArticleUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe(false)
    expect(isSafeArticleUrl("vbscript:msgbox(1)")).toBe(false)
    expect(isSafeArticleUrl("file:///etc/passwd")).toBe(false)
  })

  it("refuses http, because a news link is not worth a downgrade", () => {
    expect(isSafeArticleUrl("http://example.test/a")).toBe(false)
  })

  it("refuses a URL carrying credentials, which is a phishing shape", () => {
    expect(isSafeArticleUrl("https://apple.com@evil.test/a")).toBe(false)
  })

  it("refuses a relative or malformed URL", () => {
    expect(isSafeArticleUrl("/dashboard")).toBe(false)
    expect(isSafeArticleUrl("not a url")).toBe(false)
    expect(isSafeArticleUrl("")).toBe(false)
  })

  it("refuses an unbounded URL", () => {
    expect(isSafeArticleUrl(`https://example.test/${"a".repeat(MAX_URL_LENGTH)}`)).toBe(false)
  })
})

describe("canonical URLs", () => {
  it("strips tracking parameters so syndications collapse", () => {
    expect(canonicalUrl("https://a.test/x?utm_source=twitter&id=5")).toBe("https://a.test/x?id=5")
  })

  it("keeps a query parameter that is part of the identity", () => {
    expect(canonicalUrl("https://a.test/read?id=5")).toContain("id=5")
  })

  it("normalizes host case and a trailing slash", () => {
    expect(canonicalUrl("https://A.TEST/x/")).toBe("https://a.test/x")
  })

  it("is null for an unsafe URL, so it cannot seed a key", () => {
    expect(canonicalUrl("javascript:alert(1)")).toBeNull()
  })
})

describe("de-duplication", () => {
  it("keys on the canonical URL when there is one", () => {
    const a = dedupeKeyFor({ url: "https://a.test/x?utm_source=fb", title: "T", source: "S", publishedAt: "2026-09-03T09:00:00Z" })
    const b = dedupeKeyFor({ url: "https://a.test/x", title: "Different headline", source: "Other", publishedAt: "2026-09-03T11:00:00Z" })
    // Same page, so the same story however it was syndicated or retitled.
    expect(a).toBe(b)
  })

  it("never keys on the title alone", () => {
    // "Market wrap" from the same outlet every morning must not collapse into one article.
    const monday = dedupeKeyFor({ url: "bad", title: "Market wrap", source: "Wire", publishedAt: "2026-09-01T09:00:00Z" })
    const tuesday = dedupeKeyFor({ url: "bad", title: "Market wrap", source: "Wire", publishedAt: "2026-09-02T09:00:00Z" })
    expect(monday).not.toBe(tuesday)
  })

  it("tolerates an hour of drift in the published time", () => {
    // Providers disagree about publication minutes for the same article.
    const a = dedupeKeyFor({ url: "bad", title: "Same story", source: "Wire", publishedAt: "2026-09-03T09:00:00Z" })
    const b = dedupeKeyFor({ url: "bad", title: "Same story!", source: "Wire", publishedAt: "2026-09-03T10:30:00Z" })
    expect(a).toBe(b)
  })

  it("keeps the earliest publication of a story", () => {
    // A syndicated copy published later is the same news; dating it later would push a story that
    // broke this morning above one that broke since.
    const merged = dedupeArticles([
      article({ publishedAt: "2026-09-03T11:00:00.000Z", source: "Late Wire" }),
      article({ publishedAt: "2026-09-03T08:00:00.000Z", source: "First Wire" }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].source).toBe("First Wire")
  })

  it("keeps genuinely different articles", () => {
    const merged = dedupeArticles([article(), article({ dedupeKey: "url:https://b.test/y" })])
    expect(merged).toHaveLength(2)
  })
})

describe("normalizing a title for comparison", () => {
  it("ignores case, punctuation and accents", () => {
    expect(normalizeTitle("Apple's Q3 Results Beat!")).toBe(normalizeTitle("apple s q3 results beat"))
  })

  it("is bounded", () => {
    expect(normalizeTitle("a ".repeat(500)).length).toBeLessThanOrEqual(200)
  })
})

describe("presentability", () => {
  const base = { title: "A real headline", url: "https://a.test/x", source: "Wire", publishedAt: "2026-09-03T09:00:00Z" }

  it("accepts a complete article", () => {
    expect(isPresentable(base, NOW)).toBe(true)
  })

  it("refuses an article with no verifiable link", () => {
    // A story with no attributable origin is a rumour, and Stockly does not print rumours.
    expect(isPresentable({ ...base, url: "javascript:alert(1)" }, NOW)).toBe(false)
    expect(isPresentable({ ...base, url: "" }, NOW)).toBe(false)
  })

  it("refuses an article with no named source", () => {
    expect(isPresentable({ ...base, source: "  " }, NOW)).toBe(false)
  })

  it("refuses an article dated in the future", () => {
    // A provider bug or a timezone error; an article dated tomorrow sorts above everything real
    // forever.
    expect(isPresentable({ ...base, publishedAt: "2026-09-10T09:00:00Z" }, NOW)).toBe(false)
  })

  it("tolerates a little clock skew", () => {
    expect(isPresentable({ ...base, publishedAt: "2026-09-03T14:00:00Z" }, NOW)).toBe(true)
  })

  it("refuses an unparseable date rather than defaulting it", () => {
    expect(isPresentable({ ...base, publishedAt: "sometime" }, NOW)).toBe(false)
  })
})

describe("categories", () => {
  it("classifies by keyword, deterministically", () => {
    expect(classifyCategory("NVDA quarterly results beat estimates", null)).toBe("EARNINGS")
    expect(classifyCategory("Board declares dividend", null)).toBe("DIVIDEND")
    expect(classifyCategory("Firm acquires rival for $2bn", null)).toBe("M_AND_A")
    expect(classifyCategory("Inflation eases in August", null)).toBe("MACRO")
  })

  it("prefers the more specific label", () => {
    // An acquisition is a corporate action, and the specific one is the useful one.
    expect(classifyCategory("Company acquires rival in share buyback era", null)).toBe("M_AND_A")
  })

  it("returns OTHER rather than guessing", () => {
    expect(classifyCategory("A headline about nothing in particular", null)).toBe("OTHER")
  })

  it("has a label for every category", () => {
    for (const category of NEWS_CATEGORIES) expect(CATEGORY_LABELS[category].length).toBeGreaterThan(0)
  })
})

describe("sentiment", () => {
  it("needs two signals in one direction and none in the other", () => {
    expect(classifySentiment("Profit rose as revenue grew to a record high", null).sentiment).toBe("POSITIVE")
    expect(classifySentiment("Company warns of losses after recall", null).sentiment).toBe("NEGATIVE")
  })

  it("is UNKNOWN for a single signal, which is most headlines", () => {
    // The honest default. A rule-based reader of headlines is wrong often enough that pretending to
    // certainty would mislead.
    const result = classifySentiment("Revenue grew", null)
    expect(result.sentiment).toBe("UNKNOWN")
    expect(result.method).toBe("NONE")
  })

  it("is MIXED when both directions are strongly present", () => {
    expect(
      classifySentiment("Profit rose and revenue grew, but the firm warns of losses and cuts", null).sentiment,
    ).toBe("MIXED")
  })

  it("reports the method beside the label", () => {
    expect(classifySentiment("Profit rose as revenue grew to a record high", null).method).toBe("RULE_BASED")
  })

  it("never keys on recommendation vocabulary", () => {
    // "Analyst says buy" is somebody's recommendation, not the article's tone.
    expect(classifySentiment("Analyst says buy this stock now", null).sentiment).toBe("UNKNOWN")
    expect(classifySentiment("Analysts recommend selling", null).sentiment).toBe("UNKNOWN")
  })

  it("labels tone as tone, and says so", () => {
    for (const sentiment of SENTIMENTS) {
      expect(SENTIMENT_LABELS[sentiment].toLowerCase()).toContain("tone")
    }
    expect(SENTIMENT_DISCLAIMER).toContain("not what a price will do")
  })
})

describe("age", () => {
  it("reads publishedAt and never fetchedAt", () => {
    // A story published yesterday and fetched a minute ago is a day old.
    expect(ageOf("2026-09-03T11:30:00Z", NOW)).toBe("BREAKING")
    expect(ageOf("2026-09-02T12:00:00Z", NOW)).toBe("RECENT")
    expect(ageOf("2026-08-20T12:00:00Z", NOW)).toBe("OLDER")
  })

  it("is OLDER for an unparseable date rather than throwing", () => {
    expect(ageOf("nonsense", NOW)).toBe("OLDER")
  })
})

describe("relevance", () => {
  const context: RelevanceContext = {
    held: new Set(["US:NVDA"]),
    watched: new Set(["US:MSFT"]),
    markets: new Set(["US"]),
    eventSymbols: new Set(["US:NVDA"]),
  }

  it("ranks a holding above a watched symbol", () => {
    const held = relevanceOf(article({ symbols: ["US:NVDA"] }), context, NOW)
    const watched = relevanceOf(article({ symbols: ["US:MSFT"] }), context, NOW)
    expect(held).toBeGreaterThan(watched)
  })

  it("ranks a watched symbol above an unrelated one", () => {
    const watched = relevanceOf(article({ symbols: ["US:MSFT"] }), context, NOW)
    const unrelated = relevanceOf(article({ symbols: ["US:RANDOM"] }), context, NOW)
    expect(watched).toBeGreaterThan(unrelated)
  })

  it("cannot let recency outweigh ownership", () => {
    // A week-old story about a holding still ranks above a fresh headline about a stranger.
    const oldHolding = relevanceOf(
      article({ symbols: ["US:NVDA"], publishedAt: "2026-08-27T12:00:00Z" }),
      context,
      NOW,
    )
    const freshStranger = relevanceOf(
      article({ symbols: ["US:RANDOM"], publishedAt: "2026-09-03T11:59:00Z" }),
      context,
      NOW,
    )
    expect(oldHolding).toBeGreaterThan(freshStranger)
    expect(RELEVANCE_WEIGHTS.recencyMax).toBeLessThan(RELEVANCE_WEIGHTS.heldSymbol)
  })

  it("is deterministic", () => {
    const a = relevanceOf(article(), context, NOW)
    const b = relevanceOf(article(), context, NOW)
    expect(a).toBe(b)
  })

  it("sorts stably, so an identical feed never reorders itself", () => {
    const feed = [
      article({ dedupeKey: "a", symbols: ["US:RANDOM"] }),
      article({ dedupeKey: "b", symbols: ["US:RANDOM"] }),
    ]
    expect(sortArticles(feed, "RELEVANCE", context, NOW).map((a) => a.dedupeKey)).toEqual(
      sortArticles(feed, "RELEVANCE", context, NOW).map((a) => a.dedupeKey),
    )
  })

  it("sorts by date when asked, ignoring relevance", () => {
    const feed = [
      article({ dedupeKey: "old", symbols: ["US:NVDA"], publishedAt: "2026-09-01T09:00:00Z" }),
      article({ dedupeKey: "new", symbols: ["US:RANDOM"], publishedAt: "2026-09-03T09:00:00Z" }),
    ]
    expect(sortArticles(feed, "NEWEST", context, NOW)[0].dedupeKey).toBe("new")
    expect(sortArticles(feed, "OLDEST", context, NOW)[0].dedupeKey).toBe("old")
  })

  it("never mutates the feed it sorts", () => {
    const feed = [article({ dedupeKey: "a" }), article({ dedupeKey: "b" })]
    const before = JSON.stringify(feed)
    sortArticles(feed, "RELEVANCE", context, NOW)
    expect(JSON.stringify(feed)).toBe(before)
  })
})

describe("linking an article to a corporate event", () => {
  const events = [
    { symbol: "NVDA", market: "US", type: "EARNINGS", date: "2026-09-05" },
    { symbol: "NVDA", market: "US", type: "DIVIDEND", date: "2026-09-05" },
    { symbol: "MSFT", market: "US", type: "EARNINGS", date: "2026-09-05" },
  ]

  it("links on symbol, category and date, with high confidence", () => {
    const links = linkToEvents(article({ symbols: ["US:NVDA"], category: "EARNINGS" }), events)
    expect(links).toEqual([
      { symbol: "US:NVDA", eventType: "EARNINGS", eventDate: "2026-09-05", confidence: "HIGH" },
    ])
  })

  it("does not link a different company's event", () => {
    const links = linkToEvents(article({ symbols: ["US:NVDA"], category: "EARNINGS" }), events)
    expect(links.some((l) => l.symbol === "US:MSFT")).toBe(false)
  })

  it("does not link a different category", () => {
    const links = linkToEvents(article({ symbols: ["US:NVDA"], category: "MACRO" }), events)
    expect(links).toEqual([])
  })

  it("drops to medium confidence outside the window", () => {
    const far = linkToEvents(
      article({ symbols: ["US:NVDA"], category: "EARNINGS", publishedAt: "2026-08-20T09:00:00Z" }),
      events,
    )
    expect(far[0]?.confidence).toBe("MEDIUM")
  })

  it("makes no link at all when the relationship cannot be defended", () => {
    // An article a month from an event is not about it.
    const distant = linkToEvents(
      article({ symbols: ["US:NVDA"], category: "EARNINGS", publishedAt: "2026-05-01T09:00:00Z" }),
      events,
    )
    expect(distant).toEqual([])
    expect(EVENT_MATCH_WINDOW_DAYS).toBeGreaterThan(0)
  })

  it("ignores an event with no date", () => {
    const links = linkToEvents(article({ symbols: ["US:NVDA"], category: "EARNINGS" }), [
      { symbol: "NVDA", market: "US", type: "EARNINGS", date: null },
    ])
    expect(links).toEqual([])
  })
})

describe("notifications carry no portfolio figure", () => {
  it("names the symbol and the category, and nothing else", () => {
    const text = newsNotificationText(article({ symbols: ["US:NVDA"], category: "EARNINGS" }))
    expect(text).toBe("New NVDA news is available (earnings).")
    expect(text).not.toMatch(/\$|฿|position|worth|gained|portfolio/i)
  })

  it("falls back to a generic sentence with no symbol", () => {
    expect(newsNotificationText(article({ symbols: [] }))).toBe("New market news is available.")
  })
})

describe("nothing in this layer advises", () => {
  it("uses none of the forbidden vocabulary", () => {
    const sentences = [
      NEWS_DISCLAIMER,
      SENTIMENT_DISCLAIMER,
      ...Object.values(SENTIMENT_LABELS),
      ...Object.values(CATEGORY_LABELS),
      newsNotificationText(article()),
    ]
    for (const sentence of sentences) {
      for (const pattern of FORBIDDEN_INSIGHT_PATTERNS) {
        expect(pattern.test(sentence), `"${sentence}" matched ${pattern}`).toBe(false)
      }
    }
  })
})
