import { describe, expect, it } from "vitest"
import {
  capitalFlowsBetween,
  computeFeeImpact,
  computeTurnover,
  monthsBetween,
  netFlow,
  periodStart,
  previousPeriod,
  qualityOf,
  reconstructAt,
  type ReconstructionInput,
} from "./history"
import { replayPortfolio } from "./holdings"
import { computeCash } from "./cash"
import type { DomainTransaction } from "./types"

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
  tx("AAPL", "buy", 10, 60, 1, "2026-04-10", 4),
]

const CASH = [
  { kind: "deposit" as const, amount: 5_000, currency: "USD" as const, occurredOn: "2026-01-01" },
  { kind: "deposit" as const, amount: 1_000, currency: "USD" as const, occurredOn: "2026-03-01" },
  { kind: "withdrawal" as const, amount: 500, currency: "USD" as const, occurredOn: "2026-04-01" },
]

const DIVIDENDS = [
  { date: "2026-02-20", amount: 30 },
  { date: "2026-05-20", amount: 45 },
]

const INPUT: ReconstructionInput = {
  transactions: TRANSACTIONS,
  cashTransactions: CASH,
  dividends: DIVIDENDS,
  baseCurrency: "USD",
}

describe("reconstructing a past date", () => {
  it("includes a transaction dated exactly on the date", () => {
    const state = reconstructAt(INPUT, "2026-01-10")
    expect(state.positions.find((p) => p.symbol === "NVDA")?.quantity).toBe(10)
  })

  it("excludes everything after it", () => {
    const state = reconstructAt(INPUT, "2026-01-31")
    expect(state.transactionCount).toBe(1)
    expect(state.openPositionCount).toBe(1)
    expect(state.positions.find((p) => p.symbol === "AAPL")).toBeUndefined()
  })

  it("reports the cost basis as it stood, fees included", () => {
    // 10 × 100 + 1 = 1,001.
    expect(reconstructAt(INPUT, "2026-01-31").investedCapital).toBeCloseTo(1_001, 8)
  })

  it("reports realised P&L only once the sale has happened", () => {
    expect(reconstructAt(INPUT, "2026-02-28").realizedPnl).toBe(0)
    expect(reconstructAt(INPUT, "2026-03-31").realizedPnl).toBeGreaterThan(0)
  })

  it("counts dividends received by the date and no later ones", () => {
    expect(reconstructAt(INPUT, "2026-03-01").dividendsReceived).toBe(30)
    expect(reconstructAt(INPUT, "2026-06-01").dividendsReceived).toBe(75)
  })

  it("reports net contributed as external money only", () => {
    // Deposits 5,000 + 1,000, withdrawal 500. Buying shares moves money, it does not contribute it.
    expect(reconstructAt(INPUT, "2026-06-01").netContributed).toBeCloseTo(5_500, 8)
  })

  it("is empty before the portfolio existed", () => {
    const state = reconstructAt(INPUT, "2025-12-31")
    expect(state.transactionCount).toBe(0)
    expect(state.investedCapital).toBe(0)
    expect(state.openPositionCount).toBe(0)
  })

  it("carries no market value, because that would need a price it was not given", () => {
    // A shape that carried one would invite defaulting it to zero for a date with no snapshot.
    const state = reconstructAt(INPUT, "2026-06-01")
    expect("totalValue" in state).toBe(false)
    expect("marketValue" in state).toBe(false)
  })
})

describe("reconstruction agrees with the live engine", () => {
  /**
   * The invariant the whole module exists to guarantee: reconstructing *today* must produce
   * exactly what the dashboard produces, because both replay the same transactions through the
   * same function. If these ever diverge, a second engine has been introduced.
   */
  it("matches replayPortfolio for the present", () => {
    const state = reconstructAt(INPUT, "2026-12-31")
    const { positions, trades } = replayPortfolio(TRANSACTIONS)
    expect(state.positions).toEqual(positions)
    expect(state.trades).toEqual(trades)
  })

  it("matches computeCash for the present", () => {
    const state = reconstructAt(INPUT, "2026-12-31")
    const cash = computeCash(
      TRANSACTIONS,
      CASH,
      DIVIDENDS.map((d) => ({ netAmount: d.amount, paidOn: d.date })),
    )
    expect(state.cashBalance).toBe(cash.balance)
    expect(state.netContributed).toBe(cash.netContributed)
  })

  it("never mutates its input", () => {
    const before = JSON.stringify(INPUT)
    reconstructAt(INPUT, "2026-03-01")
    reconstructAt(INPUT, "2026-06-01")
    expect(JSON.stringify(INPUT)).toBe(before)
  })

  it("is deterministic", () => {
    expect(JSON.stringify(reconstructAt(INPUT, "2026-04-15"))).toBe(
      JSON.stringify(reconstructAt(INPUT, "2026-04-15")),
    )
  })
})

describe("capital flows", () => {
  it("counts deposits and withdrawals and nothing else", () => {
    // A buy is not a capital flow: the money was already inside the portfolio.
    const flows = capitalFlowsBetween(CASH, "2025-12-31", "2026-12-31")
    expect(flows.map((f) => f.kind)).toEqual(["DEPOSIT", "DEPOSIT", "WITHDRAWAL"])
  })

  it("treats the start as exclusive and the end as inclusive", () => {
    // So consecutive periods neither double-count a flow nor lose one between them.
    const first = capitalFlowsBetween(CASH, "2025-12-31", "2026-03-01")
    const second = capitalFlowsBetween(CASH, "2026-03-01", "2026-06-01")
    expect(first).toHaveLength(2)
    expect(second).toHaveLength(1)
    expect(first.length + second.length).toBe(3)
  })

  it("nets to external money added", () => {
    expect(netFlow(capitalFlowsBetween(CASH, "2025-12-31", "2026-12-31"))).toBeCloseTo(5_500, 8)
  })

  it("nets negative when more was withdrawn than paid in", () => {
    const withdrawals = [
      { kind: "withdrawal" as const, amount: 900, currency: "USD" as const, occurredOn: "2026-05-01" },
    ]
    expect(netFlow(capitalFlowsBetween(withdrawals, "2026-01-01", "2026-12-31"))).toBe(-900)
  })
})

describe("data quality of a historical point", () => {
  it("is complete when everything was valued", () => {
    expect(qualityOf({ hasValue: true, missingHoldings: 0, stale: false })).toEqual({
      quality: "COMPLETE",
      reason: null,
    })
  })

  it("is unavailable rather than zero when there is no valuation", () => {
    const result = qualityOf({ hasValue: false, missingHoldings: 0, stale: false })
    expect(result.quality).toBe("UNAVAILABLE")
    expect(result.reason).toContain("No valuation")
  })

  it("names how many holdings a partial total excludes", () => {
    const result = qualityOf({ hasValue: true, missingHoldings: 2, stale: false })
    expect(result.quality).toBe("PARTIAL")
    expect(result.reason).toContain("2 holdings")
  })

  it("ranks stale above partial, because an old price is the bigger problem", () => {
    expect(qualityOf({ hasValue: true, missingHoldings: 3, stale: true }).quality).toBe("STALE")
  })
})

describe("periods", () => {
  const now = new Date("2026-09-03T12:00:00Z")

  it("computes each start from the current date", () => {
    expect(periodStart("1W", now)).toBe("2026-08-27")
    expect(periodStart("1M", now)).toBe("2026-08-03")
    expect(periodStart("YTD", now)).toBe("2026-01-01")
    expect(periodStart("1Y", now)).toBe("2025-09-03")
    expect(periodStart("MAX", now)).toBeNull()
  })

  it("offers an equal-length previous period ending where this one starts", () => {
    // 3 Aug to 3 Sep is 31 days, so the previous window is the 31 days before 3 Aug — equal
    // length in days rather than equal in calendar months, which would not be like-for-like.
    const previous = previousPeriod("1M", now)
    expect(previous?.end).toBe("2026-08-03")
    expect(previous?.start).toBe("2026-07-03")
  })

  it("has no previous period for MAX", () => {
    // Comparing a portfolio's whole life against a window before it existed answers nothing.
    expect(previousPeriod("MAX", now)).toBeNull()
  })

  it("lists every month between two dates, including empty ones", () => {
    expect(monthsBetween("2026-01-15", "2026-04-02")).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"])
  })

  it("returns nothing for a reversed or invalid range", () => {
    expect(monthsBetween("2026-04-01", "2026-01-01")).toEqual([])
    expect(monthsBetween("nonsense", "2026-01-01")).toEqual([])
  })
})

describe("turnover", () => {
  it("measures money traded, and counts orders separately", () => {
    // Fifty small rebalancing trades and one large purchase are very different turnovers and
    // identical order counts. Both are reported and neither is called the other.
    const turnover = computeTurnover(TRANSACTIONS, "2025-12-31", "2026-12-31", 2_000)
    expect(turnover.buyVolume).toBeCloseTo(10 * 100 + 20 * 50 + 10 * 60, 8)
    expect(turnover.sellVolume).toBeCloseTo(4 * 150, 8)
    expect(turnover.orderCount).toBe(4)
  })

  it("is null without an average value to divide by", () => {
    expect(computeTurnover(TRANSACTIONS, "2025-12-31", "2026-12-31", null).ratio).toBeNull()
    expect(computeTurnover(TRANSACTIONS, "2025-12-31", "2026-12-31", 0).ratio).toBeNull()
  })

  it("uses the lesser of buys and sells, which is what actually turned over", () => {
    const turnover = computeTurnover(TRANSACTIONS, "2025-12-31", "2026-12-31", 1_000)
    expect(turnover.ratio).toBeCloseTo((600 / 1_000) * 100, 6)
  })
})

describe("fee impact", () => {
  it("reports the total and both ratios", () => {
    const impact = computeFeeImpact(TRANSACTIONS, 2_000)
    expect(impact.total).toBeCloseTo(4, 8)
    expect(impact.ofInvestedCapital).toBeCloseTo(0.2, 6)
    expect(impact.ofTradingVolume).toBeCloseTo((4 / 3_200) * 100, 6)
  })

  it("is null rather than zero when there is nothing to divide by", () => {
    // 0% would read as "fees are negligible" rather than "there is no answer".
    const impact = computeFeeImpact([], 0)
    expect(impact.ofInvestedCapital).toBeNull()
    expect(impact.ofTradingVolume).toBeNull()
  })
})
