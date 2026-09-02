import { describe, expect, it } from "vitest"
import { transactionInputSchema } from "./schema"
import { alertInputSchema } from "@/features/alerts/schema"
import { dividendInputSchema } from "@/features/dividends/schema"
import { cashInputSchema } from "@/features/cash/schema"
import { portfolioInputSchema } from "@/features/portfolios/schema"

/**
 * Market and currency arrive from the client, so they are validated at the boundary like any other
 * external input — closed enums, never a string the server later interprets. A market the app
 * cannot price would be routed to the wrong provider and valued in the wrong currency, which is a
 * silently-wrong number rather than a visible error, so it has to be impossible to store.
 */
const PORTFOLIO_ID = "11111111-1111-4111-8111-111111111111"

const transaction = (over: Record<string, unknown> = {}) => ({
  portfolioId: PORTFOLIO_ID,
  symbol: "NVDA",
  side: "buy",
  tradeDate: "2026-01-02",
  quantity: 10,
  price: 170,
  ...over,
})

describe("market on a transaction", () => {
  it("accepts a supported market", () => {
    expect(transactionInputSchema.parse(transaction({ market: "SET", symbol: "PTT" })).market).toBe("SET")
  })

  it("defaults to US, matching the database column", () => {
    expect(transactionInputSchema.parse(transaction()).market).toBe("US")
  })

  it("rejects a market the app cannot price", () => {
    expect(transactionInputSchema.safeParse(transaction({ market: "XETRA" })).success).toBe(false)
    expect(transactionInputSchema.safeParse(transaction({ market: "us" })).success).toBe(false)
  })

  it("rejects a SQL fragment where a market belongs", () => {
    const attack = transaction({ market: "US'; drop table transactions; --" })
    expect(transactionInputSchema.safeParse(attack).success).toBe(false)
  })

  it("rejects a non-string market", () => {
    expect(transactionInputSchema.safeParse(transaction({ market: 1 })).success).toBe(false)
    expect(transactionInputSchema.safeParse(transaction({ market: null })).success).toBe(false)
  })
})

describe("currency on a portfolio", () => {
  it("accepts the currencies a portfolio can be denominated in", () => {
    expect(portfolioInputSchema.parse({ name: "Thai", currency: "THB" }).currency).toBe("THB")
  })

  it("defaults to USD for backward compatibility", () => {
    expect(portfolioInputSchema.parse({ name: "Main" }).currency).toBe("USD")
  })

  it("rejects a currency the app cannot price or convert", () => {
    expect(portfolioInputSchema.safeParse({ name: "Crypto", currency: "BTC" }).success).toBe(false)
    // Previously any three capitals were allowed; the enum closes that.
    expect(portfolioInputSchema.safeParse({ name: "Bad", currency: "ZZZ" }).success).toBe(false)
  })

  it("rejects an injection attempt in a currency field", () => {
    expect(
      portfolioInputSchema.safeParse({ name: "Bad", currency: "USD' or 1=1 --" }).success,
    ).toBe(false)
  })
})

describe("market and currency elsewhere", () => {
  it("validates a dividend's market and optional payment currency", () => {
    const base = {
      portfolioId: PORTFOLIO_ID,
      symbol: "PTT",
      paymentDate: "2026-02-02",
      shares: 1000,
      dividendPerShare: 1.2,
    }
    expect(dividendInputSchema.parse({ ...base, market: "SET" })).toMatchObject({ market: "SET" })
    // Currency is optional — the route defaults it to the market's — but must be known when given.
    expect(dividendInputSchema.parse(base).currency).toBeUndefined()
    expect(dividendInputSchema.safeParse({ ...base, currency: "XXX" }).success).toBe(false)
  })

  it("validates a cash movement's currency", () => {
    const base = {
      portfolioId: PORTFOLIO_ID,
      kind: "deposit",
      amount: 1000,
      occurredOn: "2026-02-02",
    }
    expect(cashInputSchema.parse({ ...base, currency: "THB" }).currency).toBe("THB")
    expect(cashInputSchema.safeParse({ ...base, currency: "XXX" }).success).toBe(false)
  })

  it("validates an alert's market, which fixes the currency of its target", () => {
    const base = { type: "PRICE_ABOVE", symbol: "PTT", targetValue: 35 }
    expect(alertInputSchema.parse({ ...base, market: "SET" })).toMatchObject({ market: "SET" })
    expect(alertInputSchema.parse(base).market).toBe("US")
    expect(alertInputSchema.safeParse({ ...base, market: "TSE" }).success).toBe(false)
  })
})
