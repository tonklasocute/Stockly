import { describe, expect, it } from "vitest"
import {
  comparablePeriods,
  computeGrowth,
  computeMetrics,
  computeTTM,
  growth,
  METRIC_DEFINITIONS,
  percentRatio,
  periodLabel,
  ratio,
  sumOrNull,
  type FinancialStatement,
  type FiscalPeriod,
} from "./fundamentals"

const annual = (year: number): FiscalPeriod => ({
  type: "ANNUAL",
  fiscalYear: year,
  fiscalQuarter: null,
  reportDate: `${year + 1}-02-15`,
  periodEnd: `${year}-12-31`,
})

const quarter = (year: number, q: number): FiscalPeriod => ({
  type: "QUARTERLY",
  fiscalYear: year,
  fiscalQuarter: q,
  reportDate: null,
  periodEnd: `${year}-${String(q * 3).padStart(2, "0")}-30`,
})

const statement = (overrides: Partial<FinancialStatement> = {}): FinancialStatement => ({
  symbol: "NVDA",
  market: "US",
  period: annual(2025),
  currency: "USD",
  income: {
    revenue: 1_000,
    grossProfit: 700,
    operatingIncome: 400,
    ebitda: 450,
    netIncome: 300,
    eps: 3,
    epsDiluted: 2.9,
    sharesDiluted: 100,
  },
  balance: {
    totalAssets: 2_000,
    totalLiabilities: 800,
    totalEquity: 1_200,
    cashAndEquivalents: 500,
    totalDebt: 300,
    currentAssets: 900,
    currentLiabilities: 400,
  },
  cashFlow: {
    operatingCashFlow: 450,
    capitalExpenditure: -150,
    investingCashFlow: -200,
    financingCashFlow: -100,
    dividendsPaid: -50,
  },
  source: "mock",
  fetchedAt: "2026-09-03T00:00:00.000Z",
  ...overrides,
})

describe("safe arithmetic", () => {
  it("returns null for a zero denominator rather than Infinity", () => {
    // A company with no revenue does not have an infinite margin; it has no margin.
    expect(ratio(100, 0)).toBeNull()
    expect(percentRatio(100, 0)).toBeNull()
  })

  it("returns null when either side is missing", () => {
    expect(ratio(null, 100)).toBeNull()
    expect(ratio(100, null)).toBeNull()
  })

  it("returns null for non-finite inputs", () => {
    expect(ratio(Number.NaN, 100)).toBeNull()
    expect(ratio(100, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it("computes a real ratio, including a negative one", () => {
    // A loss is a legitimate financial value and must not be rejected.
    expect(percentRatio(-200, 1_000)).toBeCloseTo(-20, 9)
  })
})

describe("growth", () => {
  it("computes a percentage change", () => {
    expect(growth(1_100, 1_000)).toBeCloseTo(10, 9)
    expect(growth(900, 1_000)).toBeCloseTo(-10, 9)
  })

  it("refuses a negative base rather than reporting a meaningless percentage", () => {
    // Growth from a loss of −10 to a profit of +5 is not "+150%". It is not defined in any way a
    // reader would interpret correctly.
    expect(growth(5, -10)).toBeNull()
  })

  it("refuses a zero base", () => {
    expect(growth(100, 0)).toBeNull()
  })

  it("refuses when either figure is missing", () => {
    expect(growth(null, 1_000)).toBeNull()
    expect(growth(1_100, null)).toBeNull()
  })
})

describe("periods", () => {
  it("labels each type distinctly", () => {
    expect(periodLabel(annual(2025))).toBe("FY2025")
    expect(periodLabel(quarter(2026, 3))).toBe("Q3 2026")
    expect(periodLabel({ ...annual(2026), type: "TTM" })).toBe("TTM")
  })

  it("refuses to compare a quarter with a year", () => {
    // The most common fundamental-analysis error: it produces a −75% "decline" that is an artefact
    // of the calendar, not of the business.
    expect(comparablePeriods(quarter(2026, 1), annual(2025))).toBe(false)
    expect(comparablePeriods(quarter(2026, 1), quarter(2025, 1))).toBe(true)
    expect(comparablePeriods(annual(2026), annual(2025))).toBe(true)
  })
})

describe("derived metrics", () => {
  const metrics = computeMetrics(statement())

  it("computes margins from the reported figures", () => {
    expect(metrics.grossMargin).toBeCloseTo(70, 9)
    expect(metrics.operatingMargin).toBeCloseTo(40, 9)
    expect(metrics.netMargin).toBeCloseTo(30, 9)
  })

  it("computes returns against period-end balances", () => {
    expect(metrics.returnOnEquity).toBeCloseTo(25, 9)
    expect(metrics.returnOnAssets).toBeCloseTo(15, 9)
  })

  it("normalises capex sign, because providers disagree about it", () => {
    // Reported negative (an outflow) or positive (an amount spent) — the subtraction must be right
    // either way.
    const negative = computeMetrics(statement())
    const positive = computeMetrics(
      statement({ cashFlow: { ...statement().cashFlow, capitalExpenditure: 150 } }),
    )
    expect(negative.freeCashFlow).toBe(300)
    expect(positive.freeCashFlow).toBe(300)
  })

  it("computes leverage and liquidity", () => {
    expect(metrics.debtToEquity).toBeCloseTo(0.25, 9)
    expect(metrics.netDebt).toBe(-200)
    expect(metrics.currentRatio).toBeCloseTo(2.25, 9)
  })

  it("reports negative net debt, which means more cash than debt", () => {
    expect(metrics.netDebt).toBeLessThan(0)
  })

  it("returns null for every metric whose input is missing, never zero", () => {
    const bare = computeMetrics(
      statement({
        income: { revenue: null, grossProfit: null, operatingIncome: null, ebitda: null, netIncome: null, eps: null, epsDiluted: null, sharesDiluted: null },
        balance: { totalAssets: null, totalLiabilities: null, totalEquity: null, cashAndEquivalents: null, totalDebt: null, currentAssets: null, currentLiabilities: null },
        cashFlow: { operatingCashFlow: null, capitalExpenditure: null, investingCashFlow: null, financingCashFlow: null, dividendsPaid: null },
      }),
    )
    for (const [key, value] of Object.entries(bare)) {
      expect(value, key).toBeNull()
    }
  })

  it("degrades one metric at a time when a statement is partial", () => {
    // A provider that covers the income statement but not the balance sheet is the normal case.
    const partial = computeMetrics(
      statement({
        balance: { totalAssets: null, totalLiabilities: null, totalEquity: null, cashAndEquivalents: null, totalDebt: null, currentAssets: null, currentLiabilities: null },
      }),
    )
    expect(partial.grossMargin).toBeCloseTo(70, 9)
    expect(partial.returnOnEquity).toBeNull()
    expect(partial.debtToEquity).toBeNull()
  })

  it("handles a loss-making company without refusing the statement", () => {
    const loss = computeMetrics(statement({ income: { ...statement().income, netIncome: -200 } }))
    expect(loss.netMargin).toBeCloseTo(-20, 9)
    expect(loss.returnOnEquity).toBeCloseTo(-16.666666, 4)
  })

  it("has a definition, a formula and an input list for every metric", () => {
    for (const key of Object.keys(metrics) as (keyof typeof metrics)[]) {
      const definition = METRIC_DEFINITIONS[key]
      expect(definition, key).toBeDefined()
      expect(definition.formula.length).toBeGreaterThan(4)
      expect(definition.requires.length).toBeGreaterThan(4)
    }
  })
})

describe("growth between periods", () => {
  it("compares two comparable periods", () => {
    const current = statement({ period: annual(2025) })
    const previous = statement({
      period: annual(2024),
      income: { ...statement().income, revenue: 800, netIncome: 200, eps: 2 },
    })
    const result = computeGrowth(current, previous)
    expect(result.revenueGrowth).toBeCloseTo(25, 9)
    expect(result.netIncomeGrowth).toBeCloseTo(50, 9)
    expect(result.from).toBe("FY2024")
    expect(result.to).toBe("FY2025")
    expect(result.unavailableReason).toBeNull()
  })

  it("refuses a quarter against a year and says why", () => {
    const result = computeGrowth(statement({ period: quarter(2026, 1) }), statement({ period: annual(2025) }))
    expect(result.revenueGrowth).toBeNull()
    expect(result.unavailableReason).toContain("different lengths of time")
  })

  it("refuses across a change of reporting currency", () => {
    // The growth figure would be mostly an exchange-rate movement.
    const result = computeGrowth(statement({ currency: "USD" }), statement({ period: annual(2024), currency: "THB" }))
    expect(result.revenueGrowth).toBeNull()
    expect(result.unavailableReason).toContain("historical exchange rates")
  })
})

describe("trailing twelve months", () => {
  const quarters = [1, 2, 3, 4].map((q) =>
    statement({
      period: quarter(2026, q),
      income: { ...statement().income, revenue: 250, netIncome: 75, eps: 0.75, sharesDiluted: 100 + q },
      cashFlow: { ...statement().cashFlow, operatingCashFlow: 110, capitalExpenditure: -40 },
    }),
  )

  it("sums flow figures across four quarters", () => {
    const ttm = computeTTM(quarters)!
    expect(ttm.income.revenue).toBe(1_000)
    expect(ttm.income.netIncome).toBe(300)
    expect(ttm.cashFlow.operatingCashFlow).toBe(440)
  })

  it("takes the balance sheet from the latest quarter rather than summing it", () => {
    // A balance sheet is a moment; adding four of them produces a number that means nothing.
    const ttm = computeTTM(quarters)!
    expect(ttm.balance.totalAssets).toBe(2_000)
  })

  it("takes the share count from the latest quarter, because it is a level not a flow", () => {
    expect(computeTTM(quarters)!.income.sharesDiluted).toBe(104)
  })

  it("refuses fewer than four quarters rather than annualising", () => {
    // Three quarters scaled up is a fabrication.
    expect(computeTTM(quarters.slice(0, 3))).toBeNull()
  })

  it("refuses if any quarter is missing a figure, rather than understating the total", () => {
    const withGap = [...quarters]
    withGap[2] = statement({ period: quarter(2026, 3), income: { ...statement().income, revenue: null } })
    expect(computeTTM(withGap)!.income.revenue).toBeNull()
  })

  it("refuses a mix of currencies", () => {
    const mixed = [...quarters]
    mixed[0] = statement({ period: quarter(2026, 1), currency: "THB" })
    expect(computeTTM(mixed)).toBeNull()
  })

  it("refuses annual statements", () => {
    expect(computeTTM([statement(), statement(), statement(), statement()])).toBeNull()
  })

  it("labels itself as TTM", () => {
    expect(periodLabel(computeTTM(quarters)!.period)).toBe("TTM")
  })
})

describe("sumOrNull", () => {
  it("sums when everything is present", () => {
    expect(sumOrNull([1, 2, 3])).toBe(6)
  })

  it("returns null when anything is missing", () => {
    expect(sumOrNull([1, null, 3])).toBeNull()
    expect(sumOrNull([])).toBeNull()
  })
})
