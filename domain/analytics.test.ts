import { describe, expect, it } from "vitest"
import {
  allocateBy,
  allocateByHolding,
  computeConcentration,
  computeContribution,
  computeFees,
  computeTradeStatistics,
  investedCapitalSeries,
  isAllUnknown,
  performanceSeries,
  rangeStart,
  todayMovers,
  topMovers,
  withinRange,
} from "./analytics"
import { buildPortfolio, replayPortfolio } from "./holdings"
import type { DomainTransaction, Holding } from "./types"

const tx = (
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  fee = 0,
  tradeDate = "2026-01-01",
  sequence = 0,
): DomainTransaction => ({ symbol, side, quantity, price, fee, tradeDate, sequence })

const holding = (symbol: string, marketValue: number, extra: Partial<Holding> = {}): Holding => ({
  symbol,
  quantity: 1,
  investedValue: marketValue,
  averageCost: marketValue,
  realizedPnl: 0,
  currentPrice: marketValue,
  marketValue,
  unrealizedPnl: 0,
  returnPct: 0,
  weight: 0,
  todayPnl: null,
  todayReturnPct: null,
  stale: false,
  ...extra,
})

const TODAY = new Date("2026-09-01T00:00:00Z")

describe("allocation", () => {
  it("includes cash as a slice so weights sum to 100", () => {
    const slices = allocateByHolding([holding("NVDA", 700), holding("AAPL", 300)], 1000)
    expect(slices.map((s) => s.key)).toEqual(["__cash", "NVDA", "AAPL"])
    expect(slices.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(100, 4)
    expect(slices.find((s) => s.key === "__cash")?.weight).toBe(50)
  })

  it("omits cash when there is none", () => {
    expect(allocateByHolding([holding("NVDA", 100)], 0).map((s) => s.key)).toEqual(["NVDA"])
  })

  it("ignores a negative cash balance rather than producing a negative slice", () => {
    const slices = allocateByHolding([holding("NVDA", 100)], -500)
    expect(slices).toHaveLength(1)
    expect(slices[0].weight).toBe(100)
  })

  it("handles a portfolio that is only cash", () => {
    const slices = allocateByHolding([], 5000)
    expect(slices).toEqual([{ key: "__cash", label: "Cash", value: 5000, weight: 100 }])
  })

  it("handles a completely empty portfolio", () => {
    expect(allocateByHolding([], 0)).toEqual([])
  })
})

describe("allocateBy metadata", () => {
  const holdings = [holding("NVDA", 600), holding("AAPL", 300), holding("XYZ", 100)]
  const facts: Record<string, { sector: string | null }> = {
    NVDA: { sector: "Technology" },
    AAPL: { sector: "Technology" },
    XYZ: { sector: null },
  }

  it("groups by sector and folds missing data into Unknown", () => {
    const slices = allocateBy(holdings, (s) => facts[s], "sector")
    expect(slices).toEqual([
      { key: "Technology", label: "Technology", value: 900, weight: 90 },
      { key: "Unknown", label: "Unknown", value: 100, weight: 10 },
    ])
  })

  it("sorts Unknown last even when it is the largest bucket", () => {
    const slices = allocateBy([holding("XYZ", 900), holding("NVDA", 100)], (s) => facts[s], "sector")
    expect(slices[slices.length - 1].key).toBe("Unknown")
  })

  it("treats a blank string as unknown", () => {
    const slices = allocateBy([holding("A", 10)], () => ({ sector: "   " }), "sector")
    expect(slices[0].key).toBe("Unknown")
  })

  it("detects when the provider knew nothing, so the section can be hidden", () => {
    expect(isAllUnknown(allocateBy(holdings, () => undefined, "sector"))).toBe(true)
    expect(isAllUnknown(allocateBy(holdings, (s) => facts[s], "sector"))).toBe(false)
  })

  it("never drops a holding from the total", () => {
    const slices = allocateBy(holdings, () => undefined, "sector")
    expect(slices.reduce((sum, s) => sum + s.value, 0)).toBe(1000)
  })
})

describe("concentration", () => {
  it("reports the largest position and the top-N weights", () => {
    const holdings = [
      holding("NVDA", 5000),
      holding("AAPL", 2000),
      holding("MSFT", 1500),
      holding("SOFI", 1000),
      holding("AMD", 500),
    ]
    const c = computeConcentration(holdings, 0)
    expect(c.largest).toEqual({ symbol: "NVDA", weight: 50 })
    expect(c.top3Weight).toBe(85)
    expect(c.top5Weight).toBe(100)
    expect(c.positionCount).toBe(5)
    expect(c.level).toBe("concentrated")
  })

  it("dilutes concentration with cash, because cash is part of the portfolio", () => {
    const c = computeConcentration([holding("NVDA", 5000)], 5000)
    expect(c.largest?.weight).toBe(50)
    expect(c.cashWeight).toBe(50)
  })

  it("calls a spread portfolio diversified", () => {
    const holdings = Array.from({ length: 10 }, (_, i) => holding(`S${i}`, 100))
    expect(computeConcentration(holdings, 0).level).toBe("diversified")
  })

  it("handles a single holding", () => {
    expect(computeConcentration([holding("NVDA", 100)], 0)).toMatchObject({
      top3Weight: 100,
      level: "concentrated",
    })
  })

  it("handles no holdings at all", () => {
    expect(computeConcentration([], 0)).toMatchObject({ largest: null, top3Weight: 0 })
  })
})

describe("movers", () => {
  const holdings = [
    holding("WIN", 1200, { unrealizedPnl: 200, returnPct: 20 }),
    holding("FLAT", 1000, { unrealizedPnl: 0, returnPct: 0 }),
    holding("LOSE", 800, { unrealizedPnl: -200, returnPct: -20 }),
  ]

  it("splits gainers and losers, excluding flat positions from both", () => {
    const { gainers, losers } = topMovers(holdings)
    expect(gainers.map((g) => g.symbol)).toEqual(["WIN"])
    expect(losers.map((l) => l.symbol)).toEqual(["LOSE"])
  })

  it("returns null for today's movers when no holding has a previous close", () => {
    expect(todayMovers(holdings)).toBeNull()
  })

  it("uses only the holdings that do have a previous close", () => {
    const withToday = [
      holding("A", 100, { todayPnl: 5, todayReturnPct: 5 }),
      holding("B", 100, { todayPnl: null, todayReturnPct: null }),
    ]
    const movers = todayMovers(withToday)
    expect(movers?.gainers.map((g) => g.symbol)).toEqual(["A"])
  })

  it("is empty for an empty portfolio", () => {
    expect(topMovers([])).toEqual({ gainers: [], losers: [] })
  })
})

describe("contribution", () => {
  it("separates realized from unrealized and weights by absolute movement", () => {
    const { trades } = replayPortfolio([
      tx("SOFI", "buy", 100, 12, 0, "2026-01-01", 1),
      tx("SOFI", "sell", 100, 15, 0, "2026-02-01", 2),
    ])
    const rows = computeContribution([holding("NVDA", 1200, { unrealizedPnl: 200 })], trades)

    expect(rows.find((r) => r.symbol === "SOFI")).toMatchObject({ realized: 300, unrealized: 0, total: 300 })
    expect(rows.find((r) => r.symbol === "NVDA")).toMatchObject({ realized: 0, unrealized: 200, total: 200 })
    expect(rows.reduce((sum, r) => sum + r.weight, 0)).toBeCloseTo(100, 4)
  })

  it("does not divide by a net total that happens to be zero", () => {
    const rows = computeContribution(
      [holding("A", 1, { unrealizedPnl: 500 }), holding("B", 1, { unrealizedPnl: -500 })],
      [],
    )
    expect(rows.map((r) => r.weight)).toEqual([50, -50])
    expect(rows.every((r) => Number.isFinite(r.weight))).toBe(true)
  })

  it("is empty with nothing to attribute", () => {
    expect(computeContribution([], [])).toEqual([])
  })
})

describe("trade statistics", () => {
  const transactions = [
    tx("NVDA", "buy", 10, 100, 0, "2026-01-01", 1),
    tx("NVDA", "sell", 10, 150, 0, "2026-03-02", 2), // +500, closed after 60 days
    tx("SOFI", "buy", 100, 12, 0, "2026-01-05", 3),
    tx("SOFI", "sell", 50, 10, 0, "2026-02-05", 4), // -100, partial
    tx("AAPL", "buy", 10, 200, 0, "2026-01-10", 5),
    tx("AAPL", "sell", 10, 200, 0, "2026-02-10", 6), // exactly break-even
  ]
  const stats = computeTradeStatistics(transactions, replayPortfolio(transactions).trades)

  it("counts orders and trades separately", () => {
    expect(stats.buyOrders).toBe(3)
    expect(stats.sellOrders).toBe(3)
    expect(stats.totalTrades).toBe(3)
  })

  it("excludes break-even trades from the win rate denominator", () => {
    expect(stats.winningTrades).toBe(1)
    expect(stats.losingTrades).toBe(1)
    expect(stats.breakEvenTrades).toBe(1)
    expect(stats.winRate).toBe(50) // 1 of 2 decided, not 1 of 3
  })

  it("averages wins and losses separately", () => {
    expect(stats.averageWin).toBe(500)
    expect(stats.averageLoss).toBe(-100)
  })

  it("identifies the best and worst trade", () => {
    expect(stats.best?.symbol).toBe("NVDA")
    expect(stats.worst?.symbol).toBe("SOFI")
  })

  it("measures hold time only for positions that actually closed", () => {
    // NVDA and AAPL closed; the SOFI partial sell has no single purchase date.
    expect(stats.closedPositionCount).toBe(2)
    expect(stats.averageHoldDays).toBe(46) // (60 + 31) / 2 = 45.5, rounded away from zero
  })

  it("reports null rather than guessing when nothing has been sold", () => {
    const buysOnly = [tx("NVDA", "buy", 10, 100)]
    const only = computeTradeStatistics(buysOnly, replayPortfolio(buysOnly).trades)
    expect(only.winRate).toBeNull()
    expect(only.averageWin).toBeNull()
    expect(only.averageHoldDays).toBeNull()
    expect(only.best).toBeNull()
  })

  it("handles no transactions at all", () => {
    expect(computeTradeStatistics([], [])).toMatchObject({ totalTrades: 0, winRate: null })
  })
})

describe("fees", () => {
  const transactions = [
    tx("NVDA", "buy", 10, 100, 1.5, "2026-09-01"),
    tx("NVDA", "sell", 10, 110, 1.5, "2026-08-01"),
    tx("AAPL", "buy", 5, 200, 9.99, "2025-06-01"),
  ]
  const fees = computeFees(transactions, TODAY)

  it("totals fees and splits by period", () => {
    expect(fees.total).toBe(12.99)
    expect(fees.thisMonth).toBe(1.5)
    expect(fees.thisYear).toBe(3)
  })

  it("ranks fees by symbol", () => {
    expect(fees.bySymbol[0]).toEqual({ symbol: "AAPL", total: 9.99, count: 1 })
    expect(fees.bySymbol[1]).toEqual({ symbol: "NVDA", total: 3, count: 2 })
  })

  it("shows fees as a share of turnover", () => {
    // turnover = 1000 + 1100 + 1000 = 3100
    expect(fees.percentOfTurnover).toBeCloseTo(0.419032, 4)
  })

  it("handles a fee-free history", () => {
    expect(computeFees([tx("NVDA", "buy", 1, 100)], TODAY)).toMatchObject({
      total: 0,
      bySymbol: [],
    })
  })
})

describe("invested capital series", () => {
  it("tracks cost basis over time without any market data", () => {
    const points = investedCapitalSeries([
      tx("NVDA", "buy", 10, 100, 0, "2026-01-01", 1),
      tx("AAPL", "buy", 10, 200, 0, "2026-02-01", 2),
      tx("NVDA", "sell", 10, 150, 0, "2026-03-01", 3),
    ])
    expect(points.map((p) => [p.date, p.investedValue])).toEqual([
      ["2026-01-01", 1000],
      ["2026-02-01", 3000],
      ["2026-03-01", 2000],
    ])
    expect(points[2].realizedPnl).toBe(500)
  })

  it("collapses several trades on one day into a single point", () => {
    const points = investedCapitalSeries([
      tx("NVDA", "buy", 1, 100, 0, "2026-01-01", 1),
      tx("AAPL", "buy", 1, 200, 0, "2026-01-01", 2),
    ])
    expect(points).toHaveLength(1)
    expect(points[0].investedValue).toBe(300)
  })

  it("is empty with no transactions", () => {
    expect(investedCapitalSeries([])).toEqual([])
  })
})

describe("performance series", () => {
  it("measures gain against invested capital, so a deposit is not a return", () => {
    const points = performanceSeries([
      { date: "2026-01-01", totalValue: 10000, investedValue: 9000, cashValue: 1000, realizedPnl: 0, unrealizedPnl: 0 },
      // 10k deposited on day two: total value doubles, but nothing was earned.
      { date: "2026-01-02", totalValue: 20000, investedValue: 9000, cashValue: 11000, realizedPnl: 0, unrealizedPnl: 0 },
    ])
    expect(points[0].gain).toBe(0)
    expect(points[1].gain).toBe(0)
    expect(points[1].gainPct).toBe(0)
  })

  it("reports a real gain when the holdings appreciate", () => {
    const [point] = performanceSeries([
      { date: "2026-01-03", totalValue: 11000, investedValue: 9000, cashValue: 1000, realizedPnl: 0, unrealizedPnl: 1000 },
    ])
    expect(point.gain).toBe(1000)
    expect(point.gainPct).toBeCloseTo(11.111111, 4)
  })

  it("sorts by date regardless of input order", () => {
    const points = performanceSeries([
      { date: "2026-02-01", totalValue: 1, investedValue: 1, cashValue: 0, realizedPnl: 0, unrealizedPnl: 0 },
      { date: "2026-01-01", totalValue: 1, investedValue: 1, cashValue: 0, realizedPnl: 0, unrealizedPnl: 0 },
    ])
    expect(points.map((p) => p.date)).toEqual(["2026-01-01", "2026-02-01"])
  })

  it("is empty with no snapshots", () => {
    expect(performanceSeries([])).toEqual([])
  })
})

describe("time ranges", () => {
  it("computes a start date per range", () => {
    expect(rangeStart("1W", TODAY)).toBe("2026-08-25")
    expect(rangeStart("YTD", TODAY)).toBe("2026-01-01")
    expect(rangeStart("MAX", TODAY)).toBeNull()
  })

  it("filters items by whichever date field they carry", () => {
    const items = [{ paidOn: "2026-08-30" }, { paidOn: "2025-01-01" }]
    expect(withinRange(items, "1M", TODAY)).toHaveLength(1)
    expect(withinRange(items, "MAX", TODAY)).toHaveLength(2)
  })
})

describe("engine still agrees with itself", () => {
  it("contribution totals match the portfolio summary", () => {
    const transactions = [
      tx("NVDA", "buy", 10, 170, 0, "2026-01-01", 1),
      tx("SOFI", "buy", 100, 12, 0, "2026-01-03", 2),
      tx("SOFI", "sell", 20, 15, 0, "2026-02-01", 3),
    ]
    const { holdings, summary } = buildPortfolio(transactions, (s) =>
      ({ NVDA: { price: 180 }, SOFI: { price: 14 } })[s],
    )
    const rows = computeContribution(holdings, replayPortfolio(transactions).trades)
    const total = rows.reduce((sum, r) => sum + r.total, 0)
    expect(total).toBeCloseTo(summary.unrealizedPnl + summary.realizedPnl, 6)
  })
})
