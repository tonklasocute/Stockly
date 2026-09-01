import { describe, expect, it } from "vitest"
import { buildPortfolio, canSell, computePositions } from "./holdings"
import type { DomainTransaction } from "./types"

const tx = (
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  fee = 0,
  tradeDate = "2025-01-01",
  sequence = 0,
): DomainTransaction => ({ symbol, side, quantity, price, fee, tradeDate, sequence })

const near = (actual: number, expected: number) => expect(actual).toBeCloseTo(expected, 6)

describe("computePositions", () => {
  it("case 1 — a single buy", () => {
    const [p] = computePositions([tx("NVDA", "buy", 10, 170)])
    expect(p.quantity).toBe(10)
    near(p.investedValue, 1700)
    near(p.averageCost, 170)
    near(p.realizedPnl, 0)
  })

  it("case 2 — multiple buys average the cost", () => {
    const [p] = computePositions([
      tx("NVDA", "buy", 10, 170, 0, "2025-01-01"),
      tx("NVDA", "buy", 5, 180, 0, "2025-01-02"),
    ])
    expect(p.quantity).toBe(15)
    near(p.investedValue, 2600)
    near(p.averageCost, 2600 / 15) // 173.333...
  })

  it("case 3 — a partial sell books realized P&L and leaves the average cost untouched", () => {
    const [p] = computePositions([
      tx("SOFI", "buy", 100, 12, 0, "2025-01-01"),
      tx("SOFI", "sell", 20, 15, 0, "2025-02-01"),
    ])
    expect(p.quantity).toBe(80)
    near(p.averageCost, 12)
    near(p.investedValue, 960)
    near(p.realizedPnl, 60) // 20 * (15 - 12)
  })

  it("case 4 — selling everything closes the position and keeps the realized P&L", () => {
    const [p] = computePositions([
      tx("AAPL", "buy", 10, 100, 0, "2025-01-01"),
      tx("AAPL", "buy", 10, 120, 0, "2025-01-02"),
      tx("AAPL", "sell", 20, 130, 0, "2025-03-01"),
    ])
    expect(p.quantity).toBe(0)
    expect(p.investedValue).toBe(0)
    expect(p.averageCost).toBe(0)
    near(p.realizedPnl, 400) // 2600 proceeds - 2200 basis
  })

  it("case 5 — multiple stocks stay independent", () => {
    const positions = computePositions([
      tx("NVDA", "buy", 10, 170),
      tx("AAPL", "buy", 20, 200),
      tx("SOFI", "buy", 100, 12),
    ])
    expect(positions.map((p) => p.symbol).sort()).toEqual(["AAPL", "NVDA", "SOFI"])
    near(positions.find((p) => p.symbol === "AAPL")!.investedValue, 4000)
  })

  it("case 6 — fees raise the cost basis on a buy and cut the proceeds on a sell", () => {
    const [p] = computePositions([
      tx("MSFT", "buy", 10, 100, 9.9, "2025-01-01"),
      tx("MSFT", "sell", 5, 110, 5, "2025-02-01"),
    ])
    near(p.averageCost, 100.99) // (1000 + 9.9) / 10
    near(p.realizedPnl, 5 * 110 - 5 - 100.99 * 5) // 545 - 504.95
    near(p.investedValue, 504.95)
  })

  it("case 7 — an oversized sell is clamped rather than producing a negative position", () => {
    const [p] = computePositions([
      tx("TSLA", "buy", 5, 200, 0, "2025-01-01"),
      tx("TSLA", "sell", 50, 250, 0, "2025-02-01"),
    ])
    expect(p.quantity).toBe(0)
    near(p.realizedPnl, 250) // only the 5 shares actually held are sold
  })

  it("orders by trade date, not insertion order", () => {
    const out = computePositions([
      tx("NVDA", "sell", 5, 190, 0, "2025-02-01"),
      tx("NVDA", "buy", 10, 170, 0, "2025-01-01"),
    ])
    expect(out[0].quantity).toBe(5)
    near(out[0].realizedPnl, 100)
  })

  it("re-buying after a full exit starts a fresh cost basis", () => {
    const [p] = computePositions([
      tx("NVDA", "buy", 10, 100, 0, "2025-01-01"),
      tx("NVDA", "sell", 10, 150, 0, "2025-02-01"),
      tx("NVDA", "buy", 4, 200, 0, "2025-03-01"),
    ])
    expect(p.quantity).toBe(4)
    near(p.averageCost, 200)
    near(p.realizedPnl, 500)
  })
})

describe("canSell", () => {
  const held = [tx("NVDA", "buy", 10, 170, 0, "2025-01-01", 1)]

  it("allows a sell covered by the shares held", () => {
    expect(canSell(held, tx("NVDA", "sell", 10, 190, 0, "2025-02-01", 2)).ok).toBe(true)
  })

  it("rejects a sell larger than the position and reports what is available", () => {
    expect(canSell(held, tx("NVDA", "sell", 11, 190, 0, "2025-02-01", 2))).toEqual({
      ok: false,
      available: 10,
    })
  })

  it("rejects a backdated sell that precedes the buy", () => {
    expect(canSell(held, tx("NVDA", "sell", 1, 190, 0, "2024-12-31", 2))).toEqual({
      ok: false,
      available: 0,
    })
  })

  it("re-checks an edit against the other transactions once the edited row is removed", () => {
    const others = held // the previous version of the sell has been filtered out by the caller
    expect(canSell(others, tx("NVDA", "sell", 8, 195, 0, "2025-02-01", 2)).ok).toBe(true)
  })

  it("rejects a sell for a symbol that was never bought", () => {
    expect(canSell(held, tx("AMD", "sell", 1, 100, 0, "2025-02-01", 2))).toEqual({
      ok: false,
      available: 0,
    })
  })
})

describe("buildPortfolio", () => {
  const transactions = [
    tx("NVDA", "buy", 10, 170, 0, "2025-01-01", 1),
    tx("AAPL", "buy", 20, 200, 0, "2025-01-02", 2),
    tx("SOFI", "buy", 100, 12, 0, "2025-01-03", 3),
    tx("SOFI", "sell", 20, 15, 0, "2025-02-01", 4),
  ]
  const prices: Record<string, number> = { NVDA: 180, AAPL: 210, SOFI: 14 }
  const quote = (s: string) => (prices[s] === undefined ? undefined : { price: prices[s] })
  const { holdings, summary } = buildPortfolio(transactions, quote)

  it("prices each holding and computes its return", () => {
    const nvda = holdings.find((h) => h.symbol === "NVDA")!
    near(nvda.marketValue, 1800)
    near(nvda.unrealizedPnl, 100)
    near(nvda.returnPct, 5.882352941)
  })

  it("weights sum to 100%", () => {
    near(
      holdings.reduce((s, h) => s + h.weight, 0),
      100,
    )
  })

  it("sorts holdings by market value", () => {
    expect(holdings.map((h) => h.symbol)).toEqual(["AAPL", "NVDA", "SOFI"])
  })

  it("aggregates the portfolio summary", () => {
    near(summary.investedValue, 1700 + 4000 + 960)
    near(summary.marketValue, 1800 + 4200 + 1120)
    near(summary.unrealizedPnl, 460)
    near(summary.realizedPnl, 60)
    expect(summary.holdingsCount).toBe(3)
  })

  it("falls back to average cost when a symbol has no quote, and flags it stale", () => {
    const { holdings: h, summary: s } = buildPortfolio([tx("XYZ", "buy", 3, 50)], () => undefined)
    near(h[0].currentPrice, 50)
    near(h[0].unrealizedPnl, 0)
    near(h[0].returnPct, 0)
    expect(h[0].stale).toBe(true)
    expect(h[0].todayPnl).toBeNull()
    expect(s.staleCount).toBe(1)
    expect(s.todayPnl).toBeNull()
  })

  it("returns a zeroed summary for an empty portfolio", () => {
    expect(buildPortfolio([], () => ({ price: 1 })).summary).toEqual({
      marketValue: 0,
      investedValue: 0,
      unrealizedPnl: 0,
      realizedPnl: 0,
      returnPct: 0,
      holdingsCount: 0,
      todayPnl: null,
      todayReturnPct: null,
      staleCount: 0,
    })
  })
})

describe("today's change", () => {
  const holdingsOf = (prev: number | undefined, price: number) =>
    buildPortfolio([tx("NVDA", "buy", 10, 100)], () => ({ price, previousClose: prev }))

  it("is the move from yesterday's close, not from cost", () => {
    const { holdings, summary } = holdingsOf(175, 180)
    near(holdings[0].todayPnl!, 50) // 10 * (180 - 175)
    near(holdings[0].todayReturnPct!, 2.857142857)
    near(summary.todayPnl!, 50)
    near(summary.todayReturnPct!, 2.857142857)
  })

  it("goes negative on a down day", () => {
    const { summary } = holdingsOf(185, 180)
    near(summary.todayPnl!, -50)
  })

  it("is unknown, not zero, when the provider gave no previous close", () => {
    const { holdings, summary } = holdingsOf(undefined, 180)
    expect(holdings[0].todayPnl).toBeNull()
    expect(summary.todayPnl).toBeNull()
    expect(summary.todayReturnPct).toBeNull()
  })

  it("sums only the holdings that have a previous close", () => {
    const prices: Record<string, { price: number; previousClose?: number }> = {
      NVDA: { price: 180, previousClose: 175 },
      AAPL: { price: 210 }, // provider returned no previous close for this one
    }
    const { summary } = buildPortfolio(
      [tx("NVDA", "buy", 10, 100, 0, "2025-01-01", 1), tx("AAPL", "buy", 5, 200, 0, "2025-01-02", 2)],
      (s) => prices[s],
    )
    near(summary.todayPnl!, 50)
    // 10 * 175 = 1750 of yesterday value, AAPL excluded from both sides.
    near(summary.todayReturnPct!, (50 / 1750) * 100)
  })

  it("reports a flat day as zero, which is different from unknown", () => {
    const { summary } = holdingsOf(180, 180)
    expect(summary.todayPnl).toBe(0)
    near(summary.todayReturnPct!, 0)
  })
})
