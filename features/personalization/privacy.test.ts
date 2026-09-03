import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { projectPublicPortfolio, DEFAULT_SHARE_CONFIG, applyTemplate, SHARE_TEMPLATES } from "@/domain/sharing"
import { config, source } from "@/domain/sharing.test"
import type { ShareSource } from "@/domain/sharing"

/**
 * Personalization is private, and stays private when a portfolio is shared.
 *
 * The risk this guards is specific and easy to create by accident: somebody adds tags to the
 * holdings table, the share projection reads from the same shape, and a stranger reading a public
 * page learns that a position is labelled "Retirement" or "Speculative" — a sentence about the
 * owner's intentions that they never chose to publish.
 *
 * The structural defence is that `ShareSource` has nowhere to put any of it. These tests prove it
 * rather than assuming it.
 */

const PRIVATE_MARKERS = [
  "Retirement",
  "Speculative",
  "High conviction",
  "compact",
  "dashboardLayout",
]

/** A share source contaminated with every personalization field, as a careless refactor would. */
function contaminated(): ShareSource {
  return {
    ...source(),
    tags: ["Retirement", "Speculative"],
    density: "compact",
    dashboardLayout: [{ id: "summary", visible: true }],
    favoriteMetrics: ["cashRatio"],
    pinnedItems: [{ kind: "stock", ref: "US:NVDA", label: "High conviction" }],
    recentItems: [{ kind: "stock", ref: "US:AAPL", label: "AAPL" }],
    dismissedInsights: ["CONCENTRATION_HIGH"],
    defaultPortfolioId: "11111111-1111-4111-8111-111111111111",
    holdings: source().holdings.map((holding) => ({
      ...holding,
      tags: ["Retirement"],
    })),
  } as unknown as ShareSource
}

describe("no personalization reaches a shared page", () => {
  it("is absent from a published document under every preset", () => {
    for (const template of SHARE_TEMPLATES) {
      const document = projectPublicPortfolio(contaminated(), applyTemplate(config(), template))
      const serialised = JSON.stringify(document)
      for (const marker of PRIVATE_MARKERS) {
        expect(serialised.includes(marker), `${marker} leaked under ${template}`).toBe(false)
      }
    }
  })

  it("is absent with every switch turned on at once", () => {
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

  it("does not add a tags key to a published holding", () => {
    const everything = config({ showHoldings: true, showQuantity: true, showAbsoluteValues: true })
    const document = projectPublicPortfolio(contaminated(), everything)
    for (const position of document.sections.holdings?.positions ?? []) {
      expect("tags" in position).toBe(false)
    }
  })
})

describe("the share projection has nowhere to put personalization", () => {
  /**
   * The structural half. `ShareSource` is the *only* thing the projector is handed, so a field it
   * does not declare cannot be published however carelessly a caller builds one.
   */
  const sharing = readFileSync(join(process.cwd(), "domain", "sharing.ts"), "utf8")

  it("declares no personalization field", () => {
    const source = sharing.slice(sharing.indexOf("export type ShareSource"), sharing.indexOf("export type AllocationEntry"))
    for (const field of ["tags", "density", "dashboardLayout", "favoriteMetrics", "pinnedItems", "recentItems"]) {
      expect(source.includes(`${field}:`), field).toBe(false)
    }
  })

  it("never imports the personalization module", () => {
    expect(sharing.includes("personalization")).toBe(false)
  })

  it("is not imported by the share source builder either", () => {
    const builder = readFileSync(join(process.cwd(), "features", "sharing", "source.ts"), "utf8")
    expect(builder.includes("personalization")).toBe(false)
    expect(builder.includes("holding_tags")).toBe(false)
    expect(builder.includes("user_preferences")).toBe(false)
  })
})

describe("personalization is never cached across users", () => {
  it("is read per request under RLS, never from a shared cache", () => {
    // `cache()` is React's per-render memo, scoped to one request. A module-level Map keyed by
    // anything would be a cache shared between users on the same serverless instance.
    const queries = readFileSync(join(process.cwd(), "features", "personalization", "queries.ts"), "utf8")
    expect(queries.includes("new Map(")).toBe(false)
    expect(queries.includes("globalThis")).toBe(false)
    expect(queries.includes("unstable_cache")).toBe(false)
    expect(queries.includes('from "react"')).toBe(true)
  })

  it("passes no user id into a query, because RLS decides", () => {
    const queries = readFileSync(join(process.cwd(), "features", "personalization", "queries.ts"), "utf8")
    expect(queries.includes('eq("user_id"')).toBe(false)
  })

  it("is not written to the service worker's cache, which never touches /api", () => {
    const sw = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8")
    expect(sw.includes('url.pathname.startsWith("/api/")')).toBe(true)
  })
})
