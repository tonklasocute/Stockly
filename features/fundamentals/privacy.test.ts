import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { projectPublicPortfolio, DEFAULT_SHARE_CONFIG, applyTemplate, SHARE_TEMPLATES } from "@/domain/sharing"
import { config, source } from "@/domain/sharing.test"
import type { ShareSource } from "@/domain/sharing"

/**
 * Fundamentals are public. **Ownership is not.**
 *
 * The distinction this file guards is the whole privacy question of phase 17: "AAPL's P/E is 28" is
 * a fact about a company that anybody can look up, and "this person owns 500 AAPL shares" is a fact
 * about a person. A shared page may carry the first; the second is exactly what phase 13's switches
 * exist to control, and a fundamentals section added carelessly would route around them.
 */

const PRIVATE_MARKERS = ["HELD", "WATCHED", "relation", "sharesOutstanding"]

/** A share source contaminated with everything phase 17 introduced. */
function contaminated(): ShareSource {
  return {
    ...source(),
    fundamentals: { priceToEarnings: 28, netMargin: 24, revenueGrowth: 12 },
    events: [{ symbol: "NVDA", type: "EARNINGS", date: "2026-09-15", relation: "HELD" }],
    holdings: source().holdings.map((holding) => ({
      ...holding,
      relation: "HELD",
      fundamentals: { priceToEarnings: 28 },
    })),
  } as unknown as ShareSource
}

describe("no portfolio relationship reaches a shared page", () => {
  it("is absent from a published document under every preset", () => {
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

  it("adds no fundamentals key to a published holding", () => {
    const everything = config({ showHoldings: true, showQuantity: true, showAbsoluteValues: true })
    const document = projectPublicPortfolio(contaminated(), everything)
    for (const position of document.sections.holdings?.positions ?? []) {
      expect("fundamentals" in position).toBe(false)
      expect("relation" in position).toBe(false)
    }
  })
})

describe("the share projection has nowhere to put fundamentals", () => {
  const sharing = readFileSync(join(process.cwd(), "domain", "sharing.ts"), "utf8")

  it("declares no fundamental or event field on ShareSource", () => {
    const declaration = sharing.slice(
      sharing.indexOf("export type ShareSource"),
      sharing.indexOf("export type AllocationEntry"),
    )
    for (const field of ["fundamentals:", "events:", "valuation:", "earnings:"]) {
      expect(declaration.includes(field), field).toBe(false)
    }
  })

  it("never imports the fundamental layer", () => {
    for (const layer of ["fundamentals", "valuation", "corporate-events"]) {
      expect(sharing.includes(layer), layer).toBe(false)
    }
  })

  it("is not imported by the share source builder either", () => {
    const builder = readFileSync(join(process.cwd(), "features", "sharing", "source.ts"), "utf8")
    for (const layer of ["fundamentals", "corporate_events", "financial_statements"]) {
      expect(builder.includes(layer), layer).toBe(false)
    }
  })
})

describe("the events endpoint keeps ownership on the server", () => {
  const loader = readFileSync(join(process.cwd(), "features", "fundamentals", "events-loader.ts"), "utf8")

  it("joins events to holdings under the caller's own session", () => {
    // `loadPortfolioView` reads through the request-scoped client, so RLS decides what counts as
    // held. There is no service-role client anywhere in this feature.
    expect(loader.includes("loadPortfolioView")).toBe(true)
    expect(loader.includes("createAdminClient")).toBe(false)
    expect(loader.includes("service_role")).toBe(false)
  })

  it("returns a relation and never a position size", () => {
    // "Held" says why a row is there; it must not say how much.
    expect(loader.includes("quantity")).toBe(true) // used only to filter open positions
    expect(loader.includes("marketValue")).toBe(false)
    expect(loader.includes("unrealizedPnl")).toBe(false)
    expect(loader.includes("costBasis")).toBe(false)
  })

  it("bounds how many instruments one page asks a provider about", () => {
    expect(loader.includes("MAX_EVENT_INSTRUMENTS")).toBe(true)
  })
})

describe("the fundamentals loader cannot be asked about a user", () => {
  const loader = readFileSync(join(process.cwd(), "features", "fundamentals", "loader.ts"), "utf8")

  it("takes a symbol and a market, never a portfolio", () => {
    // The separation is in the signature: there is no portfolio id to pass.
    expect(loader.includes("portfolioId")).toBe(false)
    expect(loader.includes("userId")).toBe(false)
  })

  it("logs a failure with a code and never the provider's response body", () => {
    expect(loader.includes("describeError")).toBe(true)
    expect(loader.includes("JSON.stringify(result")).toBe(false)
  })
})
