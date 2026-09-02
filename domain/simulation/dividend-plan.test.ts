import { describe, expect, it } from "vitest"
import { impliedYield, projectDividends } from "./dividend-plan"
import type { DividendScenario } from "./dividend-plan"

const NOW = new Date("2026-09-02T00:00:00Z")

const scenario = (over: Partial<DividendScenario> = {}): DividendScenario => ({
  initialValue: 1_000_000,
  contribution: 0,
  frequency: "MONTHLY",
  timing: "END",
  annualReturn: 0,
  years: 5,
  contributionGrowth: 0,
  annualYield: 0.04,
  yieldGrowth: 0,
  reinvest: false,
  costBasis: 800_000,
  inflationRate: null,
  currency: "THB",
  ...over,
})

const project = (over: Partial<DividendScenario> = {}) => {
  const result = projectDividends(scenario(over), { from: NOW })
  if (!result.ok) throw new Error(`expected a projection, got ${result.reason}`)
  return result.value
}

describe("dividend projection", () => {
  it("applies the yield to each year's portfolio value", () => {
    // Flat 1,000,000 at 4% is 40,000 a year for five years.
    const result = project()
    expect(result.years).toHaveLength(5)
    expect(result.years[0].projectedIncome).toBeCloseTo(40_000, 2)
    expect(result.finalAnnualIncome).toBeCloseTo(40_000, 2)
    expect(result.cumulativeIncome).toBeCloseTo(200_000, 2)
  })

  it("grows income with the portfolio", () => {
    const result = project({ annualReturn: 0.1, years: 2 })
    expect(result.years[1].projectedIncome).toBeGreaterThan(result.years[0].projectedIncome)
  })

  it("grows the yield itself when asked to", () => {
    const result = project({ yieldGrowth: 0.05, years: 2 })
    expect(result.years[1].appliedYield).toBeCloseTo(0.04 * 1.05, 9)
  })

  it("reports income growth from the first modelled year to the last", () => {
    const result = project({ annualReturn: 0.1, years: 5 })
    expect(result.incomeGrowthPct).toBeGreaterThan(0)
  })

  it("accumulates a running total", () => {
    const result = project({ years: 3 })
    expect(result.years[2].cumulativeIncome).toBeCloseTo(
      result.years.reduce((sum, y) => sum + y.projectedIncome, 0),
      2,
    )
  })
})

describe("the two yields are never conflated", () => {
  it("divides by that year's value for yield on current value", () => {
    const result = project()
    expect(result.years[0].yieldOnValuePct).toBeCloseTo(4, 4)
  })

  it("divides by the original cost for yield on cost", () => {
    // 40,000 on a cost basis of 800,000 is 5%, not 4%.
    expect(project().years[0].yieldOnCostPct).toBeCloseTo(5, 4)
  })

  it("reports yield on cost as null when the cost basis is unknown", () => {
    const result = project({ costBasis: null })
    expect(result.years[0].yieldOnCostPct).toBeNull()
    // The other yield is unaffected: they share a numerator and nothing else.
    expect(result.years[0].yieldOnValuePct).toBeCloseTo(4, 4)
  })

  it("reports yield on cost as null for a zero cost basis rather than as infinity", () => {
    expect(project({ costBasis: 0 }).years[0].yieldOnCostPct).toBeNull()
  })
})

describe("reinvestment", () => {
  it("compounds dividends back into the portfolio", () => {
    const withDrip = project({ reinvest: true, years: 5 })
    const without = project({ reinvest: false, years: 5 })
    expect(withDrip.cumulativeIncome).toBeGreaterThan(without.cumulativeIncome)
    expect(withDrip.years[4].portfolioValue).toBeGreaterThan(without.years[4].portfolioValue)
  })

  it("counts reinvested dividends as growth, not as a contribution", () => {
    // The money came from the portfolio, not from the investor: contributions are unchanged.
    const withDrip = project({ reinvest: true, contribution: 1000, years: 3 })
    const without = project({ reinvest: false, contribution: 1000, years: 3 })
    expect(withDrip.scenario.contribution).toBe(without.scenario.contribution)
  })

  it("states the reinvestment assumption in the method", () => {
    expect(project({ reinvest: true }).method).toContain("reinvestment")
    expect(project({ reinvest: false }).method).not.toContain("reinvestment")
  })

  it("changes nothing in the first year, since dividends arrive at its end", () => {
    expect(project({ reinvest: true }).years[0].projectedIncome).toBeCloseTo(
      project({ reinvest: false }).years[0].projectedIncome,
      6,
    )
  })
})

describe("missing data produces a reason, never a zero-income projection", () => {
  it("refuses when there is no yield to assume", () => {
    const result = projectDividends(scenario({ annualYield: null }), { from: NOW })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("INSUFFICIENT_HISTORY")
  })

  it("refuses an impossible yield rather than modelling it", () => {
    for (const annualYield of [-0.1, 1.5, Number.NaN]) {
      expect(projectDividends(scenario({ annualYield }), { from: NOW }).ok).toBe(false)
    }
  })

  it("passes an invalid growth scenario's reason through", () => {
    const result = projectDividends(scenario({ years: 0 }), { from: NOW })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("INVALID_DURATION")
  })

  it("models a zero yield, which is different from an unknown one", () => {
    const result = project({ annualYield: 0 })
    expect(result.cumulativeIncome).toBe(0)
    expect(result.years[0].projectedIncome).toBe(0)
  })
})

describe("inflation", () => {
  it("restates income in today's money only when asked", () => {
    expect(project().years[0].realIncome).toBeNull()
    const withInflation = project({ inflationRate: 0.03 })
    expect(withInflation.years[4].realIncome).toBeCloseTo(
      withInflation.years[4].projectedIncome / 1.03 ** 5,
      2,
    )
  })
})

describe("implied yield", () => {
  it("derives a starting assumption from the portfolio's own income", () => {
    expect(impliedYield(40_000, 1_000_000)).toBeCloseTo(0.04, 9)
  })

  it("is null with no income or no value — an assumption Stockly cannot ground is the user's", () => {
    expect(impliedYield(0, 1_000_000)).toBeNull()
    expect(impliedYield(40_000, 0)).toBeNull()
    expect(impliedYield(Number.NaN, 1_000_000)).toBeNull()
  })
})
