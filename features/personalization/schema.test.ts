import { describe, expect, it } from "vitest"
import {
  holdingTagSchema,
  MAX_SAVED_VIEWS,
  MAX_TAGS_PER_USER,
  pinnedItemSchema,
  preferencesSchema,
  savedViewSchema,
  tagSchema,
  viewConfigSchema,
} from "./schema"

const UUID = "11111111-1111-4111-8111-111111111111"

describe("what a preferences request may contain", () => {
  it("never accepts a user id, whatever the body claims", () => {
    // The row's primary key comes from the session and RLS refuses anything else, so the endpoint
    // has no notion of acting on somebody else's preferences.
    const parsed = preferencesSchema.parse({ theme: "dark", userId: UUID })
    expect("userId" in parsed).toBe(false)
  })

  it("never accepts a figure", () => {
    const parsed = preferencesSchema.parse({ density: "compact", totalValue: 999_999 })
    expect("totalValue" in parsed).toBe(false)
  })

  it("leaves absent fields absent, so a PATCH cannot revert what it did not send", () => {
    // The theme toggle and the dashboard editor both PATCH. If an absent field parsed to a default,
    // changing the theme would silently reset the layout.
    const parsed = preferencesSchema.parse({ theme: "dark" })
    expect(parsed.density).toBeUndefined()
    expect(parsed.dashboardLayout).toBeUndefined()
    expect(parsed.favoriteMetrics).toBeUndefined()
  })

  it("rejects an unknown theme or density", () => {
    expect(preferencesSchema.safeParse({ theme: "midnight" }).success).toBe(false)
    expect(preferencesSchema.safeParse({ density: "tiny" }).success).toBe(false)
  })

  it("rejects an unknown widget id", () => {
    // A persisted layout is read back and rendered later; storing an invented id would be storing
    // something a future render has to cope with.
    expect(
      preferencesSchema.safeParse({ dashboardLayout: [{ id: "cryptoTicker", visible: true }] }).success,
    ).toBe(false)
  })

  it("rejects an unknown metric", () => {
    expect(preferencesSchema.safeParse({ favoriteMetrics: ["profit"] }).success).toBe(false)
  })

  it("caps the number of favourite metrics", () => {
    const tooMany = ["totalValue", "totalReturnPct", "todayChange", "unrealizedPnl", "realizedPnl", "cashBalance", "cashRatio"]
    expect(preferencesSchema.safeParse({ favoriteMetrics: tooMany }).success).toBe(false)
  })

  it("accepts a null default portfolio, which means 'no preference'", () => {
    expect(preferencesSchema.parse({ defaultPortfolioId: null }).defaultPortfolioId).toBeNull()
  })

  it("requires a real uuid for a default portfolio", () => {
    expect(preferencesSchema.safeParse({ defaultPortfolioId: "the-good-one" }).success).toBe(false)
  })
})

describe("saved views", () => {
  it("accepts only known filter fields and operators", () => {
    expect(
      viewConfigSchema.safeParse({ filters: [{ field: "tag", operator: "is", value: "Growth" }] }).success,
    ).toBe(true)
    expect(
      viewConfigSchema.safeParse({ filters: [{ field: "notes", operator: "is", value: "x" }] }).success,
    ).toBe(false)
    expect(
      viewConfigSchema.safeParse({ filters: [{ field: "weight", operator: "matches", value: 1 }] }).success,
    ).toBe(false)
  })

  it("refuses a structured filter value, which is how a filter becomes a query", () => {
    expect(
      viewConfigSchema.safeParse({ filters: [{ field: "tag", operator: "is", value: { $ne: null } }] })
        .success,
    ).toBe(false)
    expect(
      viewConfigSchema.safeParse({ filters: [{ field: "tag", operator: "is", value: ["a", "b"] }] })
        .success,
    ).toBe(false)
  })

  it("rejects an unknown column or grouping", () => {
    expect(viewConfigSchema.safeParse({ columns: ["costBasisSecret"] }).success).toBe(false)
    expect(viewConfigSchema.safeParse({ groupBy: "whatever" }).success).toBe(false)
  })

  it("requires at least one column, because a view with none renders nothing", () => {
    expect(viewConfigSchema.safeParse({ columns: [] }).success).toBe(false)
  })

  it("bounds the number of filters", () => {
    const filters = Array.from({ length: 11 }, () => ({ field: "market", operator: "is", value: "US" }))
    expect(viewConfigSchema.safeParse({ filters }).success).toBe(false)
  })

  it("never accepts a user id or a stored figure", () => {
    const parsed = savedViewSchema.parse({
      name: "Dividend",
      config: {},
      userId: UUID,
      marketValue: 1_000,
    })
    expect("userId" in parsed).toBe(false)
    expect("marketValue" in parsed).toBe(false)
  })

  it("defaults a view to every portfolio rather than to one", () => {
    expect(savedViewSchema.parse({ name: "Dividend", config: {} }).portfolioId).toBeNull()
  })

  it("bounds the name", () => {
    expect(savedViewSchema.safeParse({ name: "", config: {} }).success).toBe(false)
    expect(savedViewSchema.safeParse({ name: "a".repeat(41), config: {} }).success).toBe(false)
  })
})

describe("tags", () => {
  it("bounds the name and restricts the colour to the palette", () => {
    expect(tagSchema.safeParse({ name: "Growth" }).success).toBe(true)
    expect(tagSchema.safeParse({ name: "" }).success).toBe(false)
    expect(tagSchema.safeParse({ name: "a".repeat(31) }).success).toBe(false)
    // A hex value from a text field is a contrast bug waiting to happen and would not adapt to
    // dark mode.
    expect(tagSchema.safeParse({ name: "Growth", color: "#ff0000" }).success).toBe(false)
  })

  it("requires a market the application can price", () => {
    expect(holdingTagSchema.safeParse({ portfolioId: UUID, tagId: UUID, market: "US", symbol: "NVDA" }).success).toBe(true)
    expect(holdingTagSchema.safeParse({ portfolioId: UUID, tagId: UUID, market: "LSE", symbol: "BP" }).success).toBe(false)
  })

  it("never accepts a user id on an assignment", () => {
    const parsed = holdingTagSchema.parse({
      portfolioId: UUID,
      tagId: UUID,
      market: "US",
      symbol: "NVDA",
      userId: UUID,
    })
    expect("userId" in parsed).toBe(false)
  })
})

describe("pins", () => {
  it("accepts only pinnable kinds", () => {
    expect(pinnedItemSchema.safeParse({ kind: "stock", ref: "US:NVDA", label: "NVDA" }).success).toBe(true)
    expect(pinnedItemSchema.safeParse({ kind: "transaction", ref: "x", label: "y" }).success).toBe(false)
  })

  it("bounds a reference and a label", () => {
    expect(pinnedItemSchema.safeParse({ kind: "stock", ref: "a".repeat(81), label: "x" }).success).toBe(false)
    expect(pinnedItemSchema.safeParse({ kind: "stock", ref: "x", label: "a".repeat(61) }).success).toBe(false)
  })
})

describe("caps", () => {
  it("are numbers a database count can enforce", () => {
    expect(MAX_TAGS_PER_USER).toBeGreaterThan(0)
    expect(MAX_TAGS_PER_USER).toBeLessThanOrEqual(100)
    expect(MAX_SAVED_VIEWS).toBeGreaterThan(0)
    expect(MAX_SAVED_VIEWS).toBeLessThanOrEqual(100)
  })
})
