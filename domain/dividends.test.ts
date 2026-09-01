import { describe, expect, it } from "vitest"
import {
  computeYields,
  dividendAmounts,
  dividendsBySymbol,
  groupDividends,
  summarizeDividends,
  type DomainDividend,
} from "./dividends"

const div = (
  symbol: string,
  paidOn: string,
  shares: number,
  dps: number,
  tax = 0,
  fee = 0,
): DomainDividend => ({ symbol, paidOn, shares, dividendPerShare: dps, tax, fee })

const TODAY = new Date("2026-09-01T00:00:00Z")

describe("dividendAmounts", () => {
  it("computes gross, tax, fee and net", () => {
    expect(dividendAmounts(div("AAPL", "2026-08-15", 20, 0.25, 1.5, 0.5))).toEqual({
      gross: 5,
      tax: 1.5,
      fee: 0.5,
      net: 3,
    })
  })

  it("has no float dust on a realistic payment", () => {
    expect(dividendAmounts(div("MSFT", "2026-08-15", 33, 0.83)).gross).toBe(27.39)
  })

  it("treats a zero-tax payment as fully net", () => {
    expect(dividendAmounts(div("NVDA", "2026-08-15", 100, 0.01)).net).toBe(1)
  })
})

describe("grouping", () => {
  const dividends = [
    div("AAPL", "2026-01-15", 20, 0.25),
    div("AAPL", "2026-02-15", 20, 0.25),
    div("MSFT", "2026-02-20", 10, 0.75),
    div("AAPL", "2026-04-15", 20, 0.3),
  ]

  it("buckets by month, oldest first", () => {
    const months = groupDividends(dividends, "month")
    expect(months.map((m) => m.key)).toEqual(["2026-01", "2026-02", "2026-04"])
    expect(months[1].net).toBe(12.5) // 5 + 7.5
    expect(months[0].label).toBe("Jan 2026")
  })

  it("omits empty periods rather than charting them as zero", () => {
    expect(groupDividends(dividends, "month").map((m) => m.key)).not.toContain("2026-03")
  })

  it("buckets by quarter", () => {
    const quarters = groupDividends(dividends, "quarter")
    expect(quarters.map((q) => q.key)).toEqual(["2026-Q1", "2026-Q2"])
    expect(quarters[0].label).toBe("Q1 2026")
  })

  it("buckets by year", () => {
    expect(groupDividends(dividends, "year")).toHaveLength(1)
  })

  it("returns nothing for no dividends", () => {
    expect(groupDividends([], "month")).toEqual([])
  })
})

describe("dividendsBySymbol", () => {
  it("totals per symbol and weights them", () => {
    const rows = dividendsBySymbol([
      div("AAPL", "2026-01-15", 20, 0.25),
      div("AAPL", "2026-02-15", 20, 0.25),
      div("MSFT", "2026-02-20", 10, 0.5),
    ])
    expect(rows[0]).toMatchObject({ symbol: "AAPL", net: 10, count: 2, weight: 66.666667 })
    expect(rows[1]).toMatchObject({ symbol: "MSFT", net: 5 })
  })

  it("handles an empty history", () => {
    expect(dividendsBySymbol([])).toEqual([])
  })
})

describe("summarizeDividends", () => {
  const dividends = [
    div("AAPL", "2025-12-15", 20, 1), // outside this year, inside 12 months
    div("AAPL", "2026-03-15", 20, 1),
    div("MSFT", "2026-09-01", 10, 1), // today, so also "this month"
  ]

  it("splits this month, this year and trailing twelve months", () => {
    const summary = summarizeDividends(dividends, TODAY)
    expect(summary.totalNet).toBe(50)
    expect(summary.thisMonth).toBe(10)
    expect(summary.thisYear).toBe(30)
    expect(summary.trailingTwelveMonths).toBe(50)
  })

  it("averages over the months actually covered, not over twelve", () => {
    // Dec 2025 to Sep 2026 is 10 months.
    const summary = summarizeDividends(dividends, TODAY)
    expect(summary.monthsCovered).toBe(10)
    expect(summary.averageMonthly).toBeCloseTo(5, 6)
  })

  it("excludes a payment older than twelve months from the trailing figure", () => {
    const summary = summarizeDividends([div("AAPL", "2024-01-01", 100, 1)], TODAY)
    expect(summary.totalNet).toBe(100)
    expect(summary.trailingTwelveMonths).toBe(0)
  })

  it("reports zeros and a null average for no dividends", () => {
    const summary = summarizeDividends([], TODAY)
    expect(summary.totalNet).toBe(0)
    expect(summary.averageMonthly).toBeNull()
    expect(summary.count).toBe(0)
  })

  it("counts tax and fee together as the deduction", () => {
    expect(summarizeDividends([div("AAPL", "2026-08-01", 10, 1, 1.5, 0.5)], TODAY).totalTax).toBe(2)
  })
})

describe("yields", () => {
  it("distinguishes yield on current value from yield on cost", () => {
    // 100 of dividends, 2500 market value, 2000 cost.
    const yields = computeYields(100, 2500, 2000)
    expect(yields.yieldOnValue).toBe(4)
    expect(yields.yieldOnCost).toBe(5)
    // They are genuinely different numbers; conflating them is the whole point of the split.
    expect(yields.yieldOnValue).not.toBe(yields.yieldOnCost)
  })

  it("is null rather than zero when there is nothing to divide by", () => {
    expect(computeYields(100, 0, 0)).toEqual({ yieldOnValue: null, yieldOnCost: null })
  })

  it("is zero when there are no dividends but a position exists", () => {
    expect(computeYields(0, 2500, 2000).yieldOnValue).toBe(0)
  })
})
