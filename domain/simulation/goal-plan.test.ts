import { describe, expect, it } from "vitest"
import { planGoal, requiredContribution, scenarioMatrix, yearsUntil } from "./goal-plan"
import { futureValue, periodicRate } from "./growth"
import { SCENARIO_RETURNS } from "./types"
import type { GoalPlanInput } from "./goal-plan"

const NOW = new Date("2026-09-02T00:00:00Z")

const input = (over: Partial<GoalPlanInput> = {}): GoalPlanInput => ({
  currentValue: 1_000_000,
  targetValue: 2_000_000,
  contribution: 10_000,
  frequency: "MONTHLY",
  timing: "END",
  annualReturn: 0.08,
  years: 5,
  contributionGrowth: 0,
  inflationRate: null,
  currency: "THB",
  ...over,
})

const plan = (over: Partial<GoalPlanInput> = {}) => {
  const result = planGoal(input(over), { from: NOW })
  if (!result.ok) throw new Error(`expected a plan, got ${result.reason}`)
  return result.value
}

describe("goal projection", () => {
  it("projects a value and states the gap against the target", () => {
    const result = plan()
    expect(result.projectedValue).toBeGreaterThan(1_000_000)
    expect(result.targetValue).toBe(2_000_000)
    expect(result.projectedGap).toBeCloseTo(
      Math.max(0, 2_000_000 - result.projectedValue),
      4,
    )
  })

  it("floors the gap at zero once the scenario passes the target", () => {
    const result = plan({ contribution: 100_000 })
    expect(result.projectedValue).toBeGreaterThan(2_000_000)
    expect(result.projectedGap).toBe(0)
  })

  it("reports progress past 100% rather than capping it", () => {
    expect(plan({ contribution: 100_000 }).projectedProgressPct).toBeGreaterThan(100)
  })

  it("names the month the model crosses the target", () => {
    const result = plan({ contribution: 100_000 })
    expect(result.reachesTargetOn).not.toBeNull()
    expect(result.reachesTargetOn).toMatch(/^\d{4}-\d{2}-01$/)
  })

  it("reports null when the model never reaches the target in the horizon", () => {
    expect(plan({ contribution: 0, years: 1 }).reachesTargetOn).toBeNull()
  })

  it("says a target below the current value is already reached", () => {
    const result = plan({ targetValue: 500_000 })
    expect(result.alreadyReached).toBe(true)
    expect(result.projectedGap).toBe(0)
    // Not a date: it was already true before the scenario ran.
    expect(result.reachesTargetOn).toBeNull()
  })

  it("refuses a non-positive target rather than dividing by it", () => {
    const result = planGoal(input({ targetValue: 0 }), { from: NOW })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("TARGET_UNREACHABLE")
  })

  it("passes an invalid scenario's reason through rather than inventing a plan", () => {
    const result = planGoal(input({ years: 0 }), { from: NOW })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("INVALID_DURATION")
  })

  it("models a negative scenario return as a falling projection", () => {
    const result = plan({ contribution: 0, annualReturn: -0.1, years: 3 })
    expect(result.projectedValue).toBeLessThan(1_000_000)
    expect(result.projectedGap).toBeGreaterThan(1_000_000)
  })
})

describe("required contribution", () => {
  const required = (over: Parameters<typeof requiredContribution>[0]) => {
    const result = requiredContribution(over)
    if (!result.ok) throw new Error(`expected a figure, got ${result.reason}`)
    return result.value
  }

  it("produces a contribution that actually lands on the target", () => {
    // The property that matters: feeding the answer back through the growth formula reaches the goal.
    const contribution = required({
      currentValue: 1_000_000,
      targetValue: 2_000_000,
      annualReturn: 0.08,
      years: 5,
      frequency: "MONTHLY",
    })
    const landed = futureValue({
      initial: 1_000_000,
      contribution,
      periodicRate: periodicRate(0.08, 12),
      periods: 60,
    })
    expect(landed).toBeCloseTo(2_000_000, 2)
  })

  it("works at a zero return, where the annuity formula would divide by zero", () => {
    const contribution = required({
      currentValue: 0,
      targetValue: 120_000,
      annualReturn: 0,
      years: 10,
      frequency: "MONTHLY",
    })
    expect(contribution).toBeCloseTo(1000, 6)
  })

  it("is zero when the target is already covered — a real answer, not a missing one", () => {
    expect(
      required({
        currentValue: 3_000_000,
        targetValue: 2_000_000,
        annualReturn: 0.08,
        years: 5,
        frequency: "MONTHLY",
      }),
    ).toBe(0)
  })

  it("is zero when growth alone gets there", () => {
    // 1,000,000 at 8% for 10 years is over 2,000,000 with nothing added.
    expect(
      required({
        currentValue: 1_000_000,
        targetValue: 2_000_000,
        annualReturn: 0.08,
        years: 10,
        frequency: "MONTHLY",
      }),
    ).toBe(0)
  })

  it("asks for more when the horizon is shorter", () => {
    const base = { currentValue: 1_000_000, targetValue: 2_000_000, annualReturn: 0.08, frequency: "MONTHLY" as const }
    expect(required({ ...base, years: 3 })).toBeGreaterThan(required({ ...base, years: 5 }))
  })

  it("asks for more when the assumed return is lower", () => {
    const base = { currentValue: 1_000_000, targetValue: 2_000_000, years: 5, frequency: "MONTHLY" as const }
    expect(required({ ...base, annualReturn: 0.03 })).toBeGreaterThan(
      required({ ...base, annualReturn: 0.1 }),
    )
  })

  it("asks for less when payments come at the start of each period", () => {
    const base = { currentValue: 0, targetValue: 1_000_000, annualReturn: 0.08, years: 10, frequency: "MONTHLY" as const }
    expect(required({ ...base, timing: "BEGIN" })).toBeLessThan(required({ ...base, timing: "END" }))
  })

  it("scales with the frequency", () => {
    const base = { currentValue: 0, targetValue: 1_200_000, annualReturn: 0, years: 10 }
    expect(required({ ...base, frequency: "MONTHLY" })).toBeCloseTo(10_000, 4)
    expect(required({ ...base, frequency: "YEARLY" })).toBeCloseTo(120_000, 4)
  })

  it.each([
    ["INVALID_DURATION", { years: 0 }],
    ["INVALID_DURATION", { years: -1 }],
    ["TARGET_UNREACHABLE", { targetValue: 0 }],
    ["INVALID_RETURN", { annualReturn: -2 }],
    ["INVALID_INITIAL_VALUE", { currentValue: -1 }],
  ])("refuses with %s", (reason, over) => {
    const result = requiredContribution({
      currentValue: 1_000_000,
      targetValue: 2_000_000,
      annualReturn: 0.08,
      years: 5,
      frequency: "MONTHLY",
      ...over,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe(reason)
  })

  it("asks for the whole target at −100%, where only the last payment survives", () => {
    const result = requiredContribution({
      currentValue: 0,
      targetValue: 1_000_000,
      annualReturn: -1,
      years: 5,
      frequency: "MONTHLY",
    })
    // Every period wipes the balance out, so the annuity factor is exactly 1 and the last payment
    // is the whole balance. The formula produces that without a special case, which is the point
    // of solving it rather than approximating.
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBeCloseTo(1_000_000, 4)
  })
})

describe("scenario matrix", () => {
  it("returns one row per named scenario, each carrying its own rate", () => {
    const rows = scenarioMatrix(input(), { from: NOW })
    expect(rows.map((r) => r.name)).toEqual(["CONSERVATIVE", "BASE", "OPTIMISTIC"])
    expect(rows.map((r) => r.annualReturn)).toEqual([
      SCENARIO_RETURNS.CONSERVATIVE,
      SCENARIO_RETURNS.BASE,
      SCENARIO_RETURNS.OPTIMISTIC,
    ])
  })

  it("projects a higher value and needs less contribution at a higher assumed return", () => {
    const [conservative, , optimistic] = scenarioMatrix(input(), { from: NOW })
    expect(optimistic.projectedValue!).toBeGreaterThan(conservative.projectedValue!)
    expect(optimistic.requiredContribution!).toBeLessThan(conservative.requiredContribution!)
  })

  it("accepts overridden rates, because every assumption is the user's to change", () => {
    const rows = scenarioMatrix(input(), {
      from: NOW,
      returns: { CONSERVATIVE: 0.01, BASE: 0.02, OPTIMISTIC: 0.03 },
    })
    expect(rows.map((r) => r.annualReturn)).toEqual([0.01, 0.02, 0.03])
  })

  it("keeps a row whose scenario cannot be modelled, with nulls rather than dropping it", () => {
    const rows = scenarioMatrix(input({ years: 0 }), { from: NOW })
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => r.projectedValue === null)).toBe(true)
  })
})

describe("years until a target date", () => {
  it("measures the horizon from now", () => {
    expect(yearsUntil("2031-09-02", NOW)).toBeCloseTo(5, 1)
  })

  it("is null for a date that has passed — there is no scenario left to run", () => {
    expect(yearsUntil("2020-01-01", NOW)).toBeNull()
    expect(yearsUntil("2026-09-02", NOW)).toBeNull()
  })

  it("is null for no date and for an unreadable one", () => {
    expect(yearsUntil(null, NOW)).toBeNull()
    expect(yearsUntil("someday", NOW)).toBeNull()
  })
})
