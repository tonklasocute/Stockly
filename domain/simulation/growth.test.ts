import { describe, expect, it } from "vitest"
import {
  compareReturns,
  futureValue,
  periodicRate,
  realReturn,
  realValue,
  simulateGrowth,
} from "./growth"
import { MAX_YEARS, type GrowthScenario } from "./types"

const NOW = new Date("2026-09-02T00:00:00Z")

const scenario = (over: Partial<GrowthScenario> = {}): GrowthScenario => ({
  initialValue: 100_000,
  contribution: 10_000,
  frequency: "MONTHLY",
  timing: "END",
  annualReturn: 0.08,
  years: 10,
  contributionGrowth: 0,
  inflationRate: null,
  currency: "THB",
  ...over,
})

const run = (over: Partial<GrowthScenario> = {}) => {
  const result = simulateGrowth(scenario(over), { from: NOW })
  if (!result.ok) throw new Error(`expected a result, got ${result.reason}`)
  return result.value
}

describe("periodic rate", () => {
  it("is geometric, so twelve months reproduce the annual figure exactly", () => {
    const monthly = periodicRate(0.08, 12)
    expect((1 + monthly) ** 12 - 1).toBeCloseTo(0.08, 12)
  })

  it("is not the annual rate divided by the period count", () => {
    // 8% ÷ 12 compounded twelve times is 8.30%. Dividing would overstate a decade by thousands.
    expect(periodicRate(0.08, 12)).not.toBeCloseTo(0.08 / 12, 6)
  })

  it("is zero for a zero return, without going through a power", () => {
    expect(periodicRate(0, 12)).toBe(0)
  })

  it("is −1 at exactly −100%: every period wipes the balance out", () => {
    expect(periodicRate(-1, 12)).toBe(-1)
  })
})

describe("the closed-form future value", () => {
  it("compounds a lump sum with no contributions", () => {
    expect(futureValue({ initial: 1000, contribution: 0, periodicRate: 0.01, periods: 12 }))
      .toBeCloseTo(1000 * 1.01 ** 12, 9)
  })

  it("sums an ordinary annuity", () => {
    // 100 a period for 3 periods at 10%: 100(1.1²) + 100(1.1) + 100 = 331.
    expect(futureValue({ initial: 0, contribution: 100, periodicRate: 0.1, periods: 3 }))
      .toBeCloseTo(331, 9)
  })

  it("earns one extra period on every payment when contributions come first", () => {
    const end = futureValue({ initial: 0, contribution: 100, periodicRate: 0.1, periods: 3 })
    const begin = futureValue({
      initial: 0,
      contribution: 100,
      periodicRate: 0.1,
      periods: 3,
      timing: "BEGIN",
    })
    expect(begin).toBeCloseTo(end * 1.1, 9)
  })

  it("does not divide by zero at a zero rate", () => {
    expect(futureValue({ initial: 500, contribution: 100, periodicRate: 0, periods: 10 })).toBe(1500)
  })

  it("returns the initial value for no periods at all", () => {
    expect(futureValue({ initial: 500, contribution: 100, periodicRate: 0.1, periods: 0 })).toBe(500)
  })
})

describe("the iterative simulation agrees with the closed form", () => {
  /**
   * The check that stops the cheap formula and the exact loop drifting apart. The solver in
   * goal-plan.ts inverts the closed form; the chart is drawn from the loop. If they disagreed, a
   * required contribution would not produce the value it promised.
   */
  it.each([
    { annualReturn: 0.08, frequency: "MONTHLY" as const, years: 10 },
    { annualReturn: 0, frequency: "MONTHLY" as const, years: 5 },
    { annualReturn: -0.05, frequency: "QUARTERLY" as const, years: 7 },
    { annualReturn: 0.15, frequency: "YEARLY" as const, years: 20 },
  ])("matches at $annualReturn over $years years, $frequency", (over) => {
    const result = run(over)
    const periodsPerYear = { MONTHLY: 12, QUARTERLY: 4, YEARLY: 1 }[over.frequency]
    const closed = futureValue({
      initial: 100_000,
      contribution: 10_000,
      periodicRate: periodicRate(over.annualReturn, periodsPerYear),
      periods: Math.round(over.years * periodsPerYear),
    })
    expect(result.finalValue).toBeCloseTo(closed, 6)
  })

  it("matches for the beginning-of-period convention too", () => {
    const result = run({ timing: "BEGIN", years: 8 })
    const closed = futureValue({
      initial: 100_000,
      contribution: 10_000,
      periodicRate: periodicRate(0.08, 12),
      periods: 96,
      timing: "BEGIN",
    })
    expect(result.finalValue).toBeCloseTo(closed, 6)
  })
})

describe("contributions and growth are never conflated", () => {
  it("counts the initial value as money put in, not as growth", () => {
    const result = run({ contribution: 0, annualReturn: 0, years: 1 })
    expect(result.totalInvested).toBe(100_000)
    expect(result.totalContributions).toBe(0)
    expect(result.totalGrowth).toBe(0)
  })

  it("separates the three at every point on the curve", () => {
    for (const point of run().points) {
      expect(point.value).toBeCloseTo(point.contributed + point.growth, 6)
    }
  })

  it("reports growth as a share of what was put in", () => {
    const result = run({ contribution: 0, annualReturn: 0.1, years: 1 })
    expect(result.finalValue).toBeCloseTo(110_000, 2)
    expect(result.growthPct).toBeCloseTo(10, 4)
  })

  it("has no growth percentage when nothing was put in", () => {
    expect(run({ initialValue: 0, contribution: 0, years: 1 }).growthPct).toBeNull()
  })
})

describe("edge cases produce a reason, never NaN", () => {
  it.each([
    ["INVALID_INITIAL_VALUE", { initialValue: -1 }],
    ["INVALID_INITIAL_VALUE", { initialValue: Number.NaN }],
    ["INVALID_CONTRIBUTION", { contribution: -100 }],
    ["INVALID_RETURN", { annualReturn: -1.5 }],
    ["INVALID_RETURN", { annualReturn: Number.POSITIVE_INFINITY }],
    ["INVALID_DURATION", { years: 0 }],
    ["INVALID_DURATION", { years: -5 }],
    ["INVALID_DURATION", { years: MAX_YEARS + 1 }],
    ["INVALID_INFLATION", { inflationRate: -1 }],
    ["INVALID_INFLATION", { inflationRate: Number.NaN }],
  ])("refuses with %s", (reason, over) => {
    const result = simulateGrowth(scenario(over as Partial<GrowthScenario>), { from: NOW })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe(reason)
  })

  it("never lets a non-finite number reach a result", () => {
    for (const over of [{ annualReturn: 9.9, years: MAX_YEARS }, { contribution: 1e12 }]) {
      const result = simulateGrowth(scenario(over), { from: NOW })
      if (result.ok) {
        expect(Number.isFinite(result.value.finalValue)).toBe(true)
        expect(result.value.points.every((p) => Number.isFinite(p.value))).toBe(true)
      }
    }
  })

  it("models exactly −100%: each period wipes out, only the last contribution survives", () => {
    const result = run({ initialValue: 1000, contribution: 100, annualReturn: -1, years: 1 })
    expect(result.finalValue).toBeCloseTo(100, 6)
  })

  it("models a losing scenario as a loss rather than refusing it", () => {
    const result = run({ contribution: 0, annualReturn: -0.2, years: 1 })
    expect(result.finalValue).toBeCloseTo(80_000, 2)
    expect(result.totalGrowth).toBeLessThan(0)
  })
})

describe("frequency and escalating contributions", () => {
  it("produces one point per period", () => {
    expect(run({ years: 2, frequency: "MONTHLY" }).points).toHaveLength(24)
    expect(run({ years: 2, frequency: "QUARTERLY" }).points).toHaveLength(8)
    expect(run({ years: 2, frequency: "YEARLY" }).points).toHaveLength(2)
  })

  it("raises the contribution once a year, not once a period", () => {
    // A 10% "annual raise" compounding monthly would be a different, much larger number.
    const result = run({
      initialValue: 0,
      contribution: 100,
      annualReturn: 0,
      years: 2,
      contributionGrowth: 0.1,
    })
    expect(result.totalContributions).toBeCloseTo(12 * 100 + 12 * 110, 6)
  })

  it("dates each point at the end of its period", () => {
    const points = run({ years: 1, frequency: "QUARTERLY" }).points
    expect(points.map((p) => p.date)).toEqual([
      "2026-12-01",
      "2027-03-01",
      "2027-06-01",
      "2027-09-01",
    ])
  })
})

describe("inflation", () => {
  it("reports real values only when an assumption was given", () => {
    expect(run().finalRealValue).toBeNull()
    expect(run().points[0].realValue).toBeNull()
  })

  it("restates the final value in today's money", () => {
    const result = run({ contribution: 0, annualReturn: 0.08, years: 10, inflationRate: 0.03 })
    expect(result.finalRealValue).toBeCloseTo(result.finalValue / 1.03 ** 10, 2)
  })

  it("leaves the nominal figures untouched — the two never mix", () => {
    const nominal = run({ contribution: 0, years: 10 })
    const withInflation = run({ contribution: 0, years: 10, inflationRate: 0.03 })
    expect(withInflation.finalValue).toBe(nominal.finalValue)
  })

  it("treats zero inflation as an assumption that changes nothing, not as an absent one", () => {
    const result = run({ contribution: 0, years: 5, inflationRate: 0 })
    expect(result.finalRealValue).toBeCloseTo(result.finalValue, 6)
  })
})

describe("real value and real return", () => {
  it("discounts a nominal amount by the years elapsed", () => {
    expect(realValue(1000, 0.03, 10)).toBeCloseTo(1000 / 1.03 ** 10, 6)
  })

  it("is null without an inflation assumption — never the nominal figure in disguise", () => {
    expect(realValue(1000, null, 10)).toBeNull()
    expect(realReturn(0.08, null)).toBeNull()
  })

  it("uses the Fisher relation rather than subtracting", () => {
    // (1.08 / 1.03) − 1 = 4.8544%, not 5%.
    expect(realReturn(0.08, 0.03)).toBeCloseTo(1.08 / 1.03 - 1, 8)
    expect(realReturn(0.08, 0.03)).not.toBeCloseTo(0.05, 4)
  })
})

describe("comparing scenarios", () => {
  it("runs the same scenario at several rates and keeps each rate with its result", () => {
    const rows = compareReturns(scenario({ years: 5 }), [0.05, 0.08, 0.1], { from: NOW })
    expect(rows).toHaveLength(3)
    expect(rows.map((r) => r.annualReturn)).toEqual([0.05, 0.08, 0.1])
    for (const row of rows) {
      expect(row.result.ok).toBe(true)
      if (row.result.ok) expect(row.result.value.scenario.annualReturn).toBe(row.annualReturn)
    }
  })

  it("orders higher assumed returns above lower ones", () => {
    const rows = compareReturns(scenario({ years: 10 }), [0.05, 0.08, 0.1], { from: NOW })
    const values = rows.map((r) => (r.result.ok ? r.result.value.finalValue : 0))
    expect(values[0]).toBeLessThan(values[1])
    expect(values[1]).toBeLessThan(values[2])
  })
})

describe("precision", () => {
  it("does not compound rounding error along with the money", () => {
    // 600 monthly periods. Rounding the balance each period and feeding it back would drift.
    const result = run({ years: 50, contribution: 1, annualReturn: 0.07 })
    const closed = futureValue({
      initial: 100_000,
      contribution: 1,
      periodicRate: periodicRate(0.07, 12),
      periods: 600,
    })
    expect(result.finalValue).toBeCloseTo(closed, 4)
  })
})
