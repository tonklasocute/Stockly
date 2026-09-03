import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { projectPublicPortfolio, DEFAULT_SHARE_CONFIG, applyTemplate, SHARE_TEMPLATES } from "@/domain/sharing"
import { config, source } from "@/domain/sharing.test"
import type { ShareSource } from "@/domain/sharing"

/**
 * News is public. **Which news a reader is shown is not.**
 *
 * The feed is ranked by what somebody holds and watches, so *the feed itself is a description of
 * the portfolio*. A shared page carrying "your" news would leak the holdings that phase 13's
 * switches exist to control — more subtly than a holdings list, because nobody reads a news feed
 * as a disclosure.
 *
 * That is why `news_articles` grants nothing to the anonymous role and `ShareSource` has no news
 * field. These prove both.
 */

const PRIVATE_MARKERS = ["HELD", "WATCHED", "dedupeKey", "news.example.test", "relevance"]

function contaminated(): ShareSource {
  return {
    ...source(),
    news: [
      { title: "NVDA reports results", url: "https://news.example.test/a", relation: "HELD" },
      { title: "PTT declares a dividend", url: "https://news.example.test/b", relation: "WATCHED" },
    ],
    holdings: source().holdings.map((holding) => ({
      ...holding,
      news: [{ title: "Something about this holding", dedupeKey: "url:x" }],
    })),
  } as unknown as ShareSource
}

describe("no feed reaches a shared page", () => {
  it("is absent under every preset", () => {
    for (const template of SHARE_TEMPLATES) {
      const serialised = JSON.stringify(
        projectPublicPortfolio(contaminated(), applyTemplate(config(), template)),
      )
      for (const marker of PRIVATE_MARKERS) {
        expect(serialised.includes(marker), `${marker} leaked under ${template}`).toBe(false)
      }
    }
  })

  it("is absent with every sharing switch on at once", () => {
    const everything = config(
      Object.fromEntries(
        Object.keys(DEFAULT_SHARE_CONFIG)
          .filter((key) => key.startsWith("show"))
          .map((key) => [key, true]),
      ),
    )
    const serialised = JSON.stringify(projectPublicPortfolio(contaminated(), everything))
    for (const marker of PRIVATE_MARKERS) {
      expect(serialised.includes(marker), marker).toBe(false)
    }
  })

  it("adds no news key to a published holding", () => {
    const everything = config({ showHoldings: true, showQuantity: true, showAbsoluteValues: true })
    const document = projectPublicPortfolio(contaminated(), everything)
    for (const position of document.sections.holdings?.positions ?? []) {
      expect("news" in position).toBe(false)
    }
  })
})

describe("the share projection has nowhere to put news", () => {
  const sharing = readFileSync(join(process.cwd(), "domain", "sharing.ts"), "utf8")

  it("declares no news field on ShareSource", () => {
    const declaration = sharing.slice(
      sharing.indexOf("export type ShareSource"),
      sharing.indexOf("export type AllocationEntry"),
    )
    expect(declaration.includes("news")).toBe(false)
  })

  it("never imports the news layer", () => {
    expect(sharing.includes('from "./news"')).toBe(false)
  })

  it("is not imported by the share source builder either", () => {
    const builder = readFileSync(join(process.cwd(), "features", "sharing", "source.ts"), "utf8")
    expect(builder.includes("news")).toBe(false)
  })
})

describe("the feed is ranked on the server, under the reader's own session", () => {
  const loader = readFileSync(join(process.cwd(), "features", "news", "loader.ts"), "utf8")

  it("reads holdings through the request-scoped client", () => {
    // No service-role client anywhere in this feature: what counts as held is decided by RLS.
    expect(loader.includes("loadPortfolioView")).toBe(true)
    expect(loader.includes("createAdminClient")).toBe(false)
    expect(loader.includes("service_role")).toBe(false)
  })

  it("returns a relation and never a position size", () => {
    // "Held" says why an article is in the feed; it must not say how much.
    expect(loader.includes("marketValue")).toBe(false)
    expect(loader.includes("unrealizedPnl")).toBe(false)
    expect(loader.includes("costBasis")).toBe(false)
    expect(loader.includes("averageCost")).toBe(false)
  })

  it("bounds how many instruments one feed asks a provider about", () => {
    expect(loader.includes("MAX_FEED_INSTRUMENTS")).toBe(true)
  })

  it("classifies in the domain rather than trusting a provider", () => {
    // Two providers cannot disagree about what an article is, and none can smuggle in a sentiment
    // Stockly did not derive.
    expect(loader.includes("classifyCategory")).toBe(true)
    expect(loader.includes("classifySentiment")).toBe(true)
  })

  it("drops an article it cannot verify rather than repairing it", () => {
    expect(loader.includes("isPresentable")).toBe(true)
  })
})
