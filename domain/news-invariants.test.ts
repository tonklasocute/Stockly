import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildPortfolio, replayPortfolio } from "./holdings"
import { computeCash } from "./cash"
import {
  ageOf,
  classifyCategory,
  classifySentiment,
  dedupeArticles,
  dedupeKeyFor,
  isPresentable,
  isSafeArticleUrl,
  linkToEvents,
  newsNotificationText,
  relevanceOf,
  sortArticles,
  type NewsArticle,
  type RelevanceContext,
} from "./news"
import type { DomainTransaction } from "./types"

/**
 * The phase 18 invariants.
 *
 * **News is context. It is never financial truth, and it never becomes one.**
 *
 * The temptation here is different from previous phases and worth naming: an article contains
 * *numbers* — a revenue figure, a dividend amount, a price move — and every one of them is a
 * sentence somebody else wrote. None may reach a calculation. The domain module has no way to
 * receive a portfolio, which is the structural half; this is the behavioural half.
 */

const tx = (
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  fee: number,
  tradeDate: string,
  sequence: number,
): DomainTransaction => ({ symbol, side, quantity, price, fee, tradeDate, sequence })

const TRANSACTIONS = [
  tx("NVDA", "buy", 10, 100, 1, "2026-01-10", 1),
  tx("AAPL", "buy", 20, 50, 1, "2026-02-10", 2),
  tx("NVDA", "sell", 4, 150, 1, "2026-03-10", 3),
]
const CASH = [
  { kind: "deposit" as const, amount: 5_000, currency: "USD" as const, occurredOn: "2026-01-01" },
]
const DIVIDENDS = [{ netAmount: 30, paidOn: "2026-02-20" }]
const quote = (symbol: string) => ({ NVDA: { price: 180 }, AAPL: { price: 70 } })[symbol]

function financialState(): string {
  const { holdings, summary } = buildPortfolio(TRANSACTIONS, quote)
  const { trades, positions } = replayPortfolio(TRANSACTIONS)
  const cash = computeCash(TRANSACTIONS, CASH, DIVIDENDS)
  return JSON.stringify({ holdings, summary, trades, positions, cash })
}

const NOW = new Date("2026-09-03T12:00:00Z")

const article = (overrides: Partial<NewsArticle> = {}): NewsArticle => ({
  dedupeKey: "url:https://a.test/x",
  title: "NVDA revenue rose to $30 billion as profit grew",
  summary: "The company reported a dividend of $0.04 per share.",
  url: "https://a.test/x",
  source: "Wire",
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

const context: RelevanceContext = {
  held: new Set(["US:NVDA"]),
  watched: new Set(["US:AAPL"]),
  markets: new Set(["US"]),
  eventSymbols: new Set(["US:NVDA"]),
}

/** Every news operation the application performs, once each. */
function everyNewsOperation(): void {
  const feed = Array.from({ length: 50 }, (_, i) =>
    article({
      dedupeKey: `url:https://a.test/${i}`,
      url: `https://a.test/${i}`,
      publishedAt: new Date(NOW.getTime() - i * 3_600_000).toISOString(),
    }),
  )
  dedupeArticles(feed)
  sortArticles(feed, "RELEVANCE", context, NOW)
  sortArticles(feed, "NEWEST", context, NOW)
  for (const item of feed) {
    relevanceOf(item, context, NOW)
    ageOf(item.publishedAt, NOW)
    classifyCategory(item.title, item.summary)
    classifySentiment(item.title, item.summary)
    isPresentable(item, NOW)
    dedupeKeyFor(item)
    newsNotificationText(item)
    linkToEvents(item, [{ symbol: "NVDA", market: "US", type: "EARNINGS", date: "2026-09-05" }])
  }
}

describe("news cannot change a portfolio", () => {
  it("leaves holdings, cost basis, P&L and cash byte-identical", () => {
    const before = financialState()
    everyNewsOperation()
    expect(financialState()).toBe(before)
  })

  it("is stable when every operation runs repeatedly", () => {
    const before = financialState()
    for (let i = 0; i < 5; i += 1) everyNewsOperation()
    expect(financialState()).toBe(before)
  })

  it("ingesting a thousand articles creates no transaction", () => {
    const before = [...TRANSACTIONS]
    const many = Array.from({ length: 1_000 }, (_, i) =>
      article({ dedupeKey: `url:https://a.test/${i}`, url: `https://a.test/${i}` }),
    )
    dedupeArticles(many)
    sortArticles(many, "RELEVANCE", context, NOW)
    expect(TRANSACTIONS).toEqual(before)
    expect(TRANSACTIONS).toHaveLength(3)
  })

  it("a number inside a headline never reaches a calculation", () => {
    /*
     * The specific temptation of this phase: the fixture's headline says revenue "rose to $30
     * billion" and its summary names a dividend of $0.04 per share. Both are sentences somebody
     * else wrote. Neither is a figure Stockly holds.
     */
    const before = computeCash(TRANSACTIONS, CASH, DIVIDENDS)
    everyNewsOperation()
    expect(computeCash(TRANSACTIONS, CASH, DIVIDENDS)).toEqual(before)
  })

  it("never mutates the articles it reads", () => {
    const feed = [article({ dedupeKey: "a" }), article({ dedupeKey: "b" })]
    const before = JSON.stringify(feed)
    dedupeArticles(feed)
    sortArticles(feed, "RELEVANCE", context, NOW)
    expect(JSON.stringify(feed)).toBe(before)
  })

  it("linking an article to an event does not change the event", () => {
    // Phase 17 owns corporate events. A link only says the two are probably about the same thing.
    const events = [{ symbol: "NVDA", market: "US", type: "EARNINGS", date: "2026-09-05" }]
    const before = JSON.stringify(events)
    linkToEvents(article(), events)
    expect(JSON.stringify(events)).toBe(before)
  })
})

describe("the news engine cannot reach anything", () => {
  const contents = readFileSync(join(process.cwd(), "domain", "news.ts"), "utf8")

  const FORBIDDEN = [
    "@/lib/supabase",
    "supabase",
    "server-only",
    "next/",
    "revalidatePath",
    "fetch(",
    "@/services/",
    "@/features/",
    "process.env",
  ]

  for (const needle of FORBIDDEN) {
    it(`never mentions ${needle}`, () => {
      expect(contents.includes(needle)).toBe(false)
    })
  }

  it("imports only from domain/", () => {
    const imports = [...contents.matchAll(/^import[^\n]*? from "([^"]+)"/gm)].map((m) => m[1])
    for (const specifier of imports) {
      expect(specifier.startsWith("./"), `imports ${specifier}`).toBe(true)
    }
  })

  it("has no way to receive a portfolio", () => {
    expect(contents.includes("DomainTransaction")).toBe(false)
    expect(contents.includes("Holding")).toBe(false)
    expect(contents.includes("portfolioId")).toBe(false)
  })

  it("never constructs a URL, a source or a summary", () => {
    /*
     * Fabricating a headline attributed to a publication is categorically worse than fabricating a
     * number, and the module is written so there is nothing that could.
     *
     * Comments stripped first: the module explains the phishing shape it refuses using an example
     * URL, and a naive search finds the explanation.
     */
    const code = contents.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code.includes("https://")).toBe(false)
    expect(code.includes("http://")).toBe(false)
  })
})

describe("no calculation module imports news", () => {
  for (const engine of ["holdings.ts", "cash.ts", "dividends.ts", "money.ts", "analytics.ts", "returns.ts", "corporate-events.ts"]) {
    it(`${engine} does not import news`, () => {
      const contents = readFileSync(join(process.cwd(), "domain", engine), "utf8")
      expect(contents.includes('from "./news"')).toBe(false)
    })
  }
})

describe("the migration keeps news out of the portfolio", () => {
  const RAW = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260910000000_news.sql"),
    "utf8",
  )
  const SQL = RAW.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    .replace(/comment on[\s\S]*?;/g, "")
  // Whole-whitespace normalisation: a multi-line constraint is one statement.
  const FLAT = SQL.replace(/\s+/g, " ")

  it("gives neither table a user id", () => {
    expect(SQL.includes("user_id")).toBe(false)
  })

  it("never references transactions", () => {
    expect(SQL.includes("public.transactions")).toBe(false)
  })

  it("stores no article body", () => {
    // Somebody else's copyrighted work, and the reader is sent to the source.
    expect(SQL.includes("content text")).toBe(false)
    expect(SQL.includes("body text")).toBe(false)
  })

  it("enforces https at the table as well as at the boundary", () => {
    expect(SQL).toContain("url like 'https://%'")
  })

  it("refuses an article dated in the future", () => {
    expect(FLAT).toContain("check (published_at <= now() + interval '6 hours')")
  })

  it("requires a sentiment to carry its method", () => {
    expect(FLAT).toContain("check ( (sentiment = 'UNKNOWN') = (sentiment_method = 'NONE') )")
  })

  it("is readable by signed-in users and writable by none", () => {
    for (const table of ["news_articles", "news_article_symbols"]) {
      expect(FLAT).toContain(`alter table public.${table} enable row level security`)
      for (const verb of ["for insert", "for update", "for delete"]) {
        const policies = SQL.split(";").filter(
          (statement) => statement.includes(`on public.${table}`) && statement.includes(verb),
        )
        expect(policies, `${table} ${verb}`).toEqual([])
      }
    }
  })

  it("grants nothing to an anonymous role", () => {
    // A public portfolio shows no news: which articles appear is derived from what its owner holds,
    // and that would leak the holdings the sharing settings exist to control.
    expect(SQL.includes("to anon")).toBe(false)
  })

  it("makes news notifications opt-in", () => {
    expect(FLAT).toContain("add column news boolean not null default false")
  })
})

describe("every link put in front of a user is safe", () => {
  it("refuses the schemes that execute on click", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<script>", "vbscript:x", "http://a.test"]) {
      expect(isSafeArticleUrl(url), url).toBe(false)
    }
  })

  it("means an unsafe article is never presentable", () => {
    expect(
      isPresentable(
        { title: "Real headline", url: "javascript:alert(1)", source: "Wire", publishedAt: "2026-09-03T09:00:00Z" },
        NOW,
      ),
    ).toBe(false)
  })

  it("is enforced in the component that renders a link", () => {
    const list = readFileSync(
      join(process.cwd(), "features", "news", "components", "news-list.tsx"),
      "utf8",
    )
    // External links leave explicitly and cannot reach back into the opener.
    expect(list).toContain('rel="noopener noreferrer"')
    expect(list).toContain('target="_blank"')
    // Stockly never proxies or redirects through its own origin, so there is no open redirect.
    expect(list.includes("/api/redirect")).toBe(false)
    // Provider text is rendered as React children, never as HTML.
    expect(list.includes("dangerouslySetInnerHTML")).toBe(false)
  })
})
