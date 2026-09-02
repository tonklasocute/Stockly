import { describe, expect, it } from "vitest"
import { goalInputSchema, goalUpdateSchema, projectionSchema } from "./schema"
import { journalInputSchema, journalFilterSchema } from "@/features/journal/schema"
import { thesisInputSchema } from "@/features/theses/schema"

const PORTFOLIO_ID = "11111111-1111-4111-8111-111111111111"
const TRANSACTION_ID = "22222222-2222-4222-8222-222222222222"

describe("goal validation", () => {
  const base = { portfolioId: PORTFOLIO_ID, type: "PORTFOLIO_VALUE", targetValue: 100_000 }

  it("accepts a money goal with a currency", () => {
    expect(goalInputSchema.parse({ ...base, currency: "THB" })).toMatchObject({
      type: "PORTFOLIO_VALUE",
      currency: "THB",
    })
  })

  it("rejects a money goal with no currency — it would be unmeasurable", () => {
    expect(goalInputSchema.safeParse(base).success).toBe(false)
  })

  it("rejects a currency on a percentage goal", () => {
    const parsed = goalInputSchema.safeParse({
      ...base,
      type: "TOTAL_RETURN",
      targetValue: 25,
      currency: "USD",
    })
    expect(parsed.success).toBe(false)
  })

  it("accepts a percentage goal with no currency", () => {
    expect(goalInputSchema.parse({ ...base, type: "TOTAL_RETURN", targetValue: 25 }).currency)
      .toBeUndefined()
  })

  it("rejects a non-positive target — a goal of zero was never expressible", () => {
    expect(goalInputSchema.safeParse({ ...base, currency: "USD", targetValue: 0 }).success).toBe(false)
    expect(goalInputSchema.safeParse({ ...base, currency: "USD", targetValue: -5 }).success).toBe(false)
  })

  it("rejects an implausible return target rather than storing a typo", () => {
    expect(goalInputSchema.safeParse({ ...base, type: "TOTAL_RETURN", targetValue: 40_000 }).success)
      .toBe(false)
  })

  it("rejects an unknown goal type and an unknown currency", () => {
    expect(goalInputSchema.safeParse({ ...base, type: "MOON", currency: "USD" }).success).toBe(false)
    expect(goalInputSchema.safeParse({ ...base, currency: "BTC" }).success).toBe(false)
  })

  it("rejects a malformed target date", () => {
    expect(goalInputSchema.safeParse({ ...base, currency: "USD", targetDate: "soon" }).success)
      .toBe(false)
    expect(goalInputSchema.parse({ ...base, currency: "USD", targetDate: "2030-01-01" }).targetDate)
      .toBe("2030-01-01")
  })

  it("has no type field on update — changing it would reinterpret the target", () => {
    const parsed = goalUpdateSchema.parse({ targetValue: 200_000, type: "DIVIDEND_INCOME" })
    expect(parsed).not.toHaveProperty("type")
  })
})

describe("projection validation", () => {
  it("bounds the assumptions so a scenario stays arithmetic rather than nonsense", () => {
    expect(projectionSchema.safeParse({ horizonYears: 0 }).success).toBe(false)
    expect(projectionSchema.safeParse({ horizonYears: 200 }).success).toBe(false)
    expect(projectionSchema.safeParse({ annualGrowthPct: 900 }).success).toBe(false)
    expect(projectionSchema.parse({}).scenario).toBe("BASE")
  })

  it("allows a negative growth assumption — a scenario is allowed to be pessimistic", () => {
    expect(projectionSchema.parse({ annualGrowthPct: -10 }).annualGrowthPct).toBe(-10)
  })
})

describe("journal validation", () => {
  const base = {
    portfolioId: PORTFOLIO_ID,
    title: "Why I bought this",
    entryDate: "2026-01-02",
  }

  it("accepts an entry with no instrument — a market note belongs to no stock", () => {
    expect(journalInputSchema.parse(base).type).toBe("GENERAL")
  })

  it("requires a reason on a sell review and refuses one anywhere else", () => {
    expect(journalInputSchema.safeParse({ ...base, type: "SELL_REASON" }).success).toBe(false)
    expect(
      journalInputSchema.parse({ ...base, type: "SELL_REASON", reason: "THESIS_BROKEN" }).reason,
    ).toBe("THESIS_BROKEN")
    expect(
      journalInputSchema.safeParse({ ...base, type: "MARKET_NOTE", reason: "TAX" }).success,
    ).toBe(false)
  })

  it("requires a symbol on an entry pinned to a transaction", () => {
    expect(
      journalInputSchema.safeParse({ ...base, transactionId: TRANSACTION_ID }).success,
    ).toBe(false)
    expect(
      journalInputSchema.parse({ ...base, transactionId: TRANSACTION_ID, symbol: "nvda" }).symbol,
    ).toBe("NVDA")
  })

  it("rejects a future entry date and an unknown type", () => {
    expect(journalInputSchema.safeParse({ ...base, entryDate: "2099-01-01" }).success).toBe(false)
    expect(journalInputSchema.safeParse({ ...base, type: "RANT" }).success).toBe(false)
  })

  it("caps the content so one entry cannot become an upload", () => {
    expect(journalInputSchema.safeParse({ ...base, content: "x".repeat(10_001) }).success).toBe(false)
  })

  it("normalises a symbol and validates the market", () => {
    expect(journalInputSchema.parse({ ...base, symbol: " ptt ", market: "SET" })).toMatchObject({
      symbol: "PTT",
      market: "SET",
    })
    expect(journalInputSchema.safeParse({ ...base, market: "XETRA" }).success).toBe(false)
  })

  it("validates timeline filters, which arrive from a query string", () => {
    expect(journalFilterSchema.safeParse({ portfolioId: PORTFOLIO_ID, type: "GENERAL" }).success)
      .toBe(true)
    expect(journalFilterSchema.safeParse({ portfolioId: "not-a-uuid" }).success).toBe(false)
    expect(journalFilterSchema.safeParse({ portfolioId: PORTFOLIO_ID, from: "yesterday" }).success)
      .toBe(false)
  })
})

describe("thesis validation", () => {
  const base = { portfolioId: PORTFOLIO_ID, symbol: "NVDA", title: "NVDA thesis" }

  it("defaults conviction to the middle and the status to active", () => {
    expect(thesisInputSchema.parse(base)).toMatchObject({ conviction: 5, status: "ACTIVE" })
  })

  it("bounds conviction to whole numbers from 1 to 10", () => {
    expect(thesisInputSchema.safeParse({ ...base, conviction: 0 }).success).toBe(false)
    expect(thesisInputSchema.safeParse({ ...base, conviction: 11 }).success).toBe(false)
    expect(thesisInputSchema.safeParse({ ...base, conviction: 7.5 }).success).toBe(false)
    expect(thesisInputSchema.parse({ ...base, conviction: 10 }).conviction).toBe(10)
  })

  it("accepts every declared status, and nothing else", () => {
    expect(thesisInputSchema.parse({ ...base, status: "BROKEN" }).status).toBe("BROKEN")
    expect(thesisInputSchema.safeParse({ ...base, status: "DOOMED" }).success).toBe(false)
  })

  it("requires a symbol — a thesis is about an instrument", () => {
    expect(thesisInputSchema.safeParse({ ...base, symbol: "!!!" }).success).toBe(false)
  })

  it("caps each prose field so one thesis cannot become an upload", () => {
    expect(thesisInputSchema.safeParse({ ...base, whyBought: "x".repeat(4001) }).success).toBe(false)
  })
})
