import { describe, expect, it } from "vitest"
import {
  GOAL_TYPES,
  averageMonthlyContribution,
  goalProgress,
  type DomainGoal,
  type GoalFacts,
} from "./goals"

const NOW = new Date("2026-09-02T00:00:00Z")

const facts: GoalFacts = {
  baseCurrency: "USD",
  totalValue: 50_000,
  investedValue: 40_000,
  trailingTwelveMonthDividends: 1_200,
  returnPct: 12.5,
}

const goal = (over: Partial<DomainGoal> = {}): DomainGoal => ({
  type: "PORTFOLIO_VALUE",
  targetValue: 100_000,
  currency: "USD",
  targetDate: "2030-01-01",
  ...over,
})

describe("goal progress by type", () => {
  it("PORTFOLIO_VALUE measures holdings plus cash", () => {
    const progress = goalProgress(goal(), facts, { now: NOW })
    expect(progress).toMatchObject({ current: 50_000, target: 100_000, progressPct: 50, achieved: false })
    expect(progress.remaining).toBe(50_000)
  })

  it("INVESTED_CAPITAL measures cost basis, not portfolio value", () => {
    // The distinction that makes a per-type definition necessary: 40,000 invested, 50,000 in value.
    const progress = goalProgress(goal({ type: "INVESTED_CAPITAL", targetValue: 80_000 }), facts, { now: NOW })
    expect(progress.current).toBe(40_000)
    expect(progress.progressPct).toBe(50)
  })

  it("DIVIDEND_INCOME measures the trailing twelve months, as a rate of income", () => {
    const progress = goalProgress(goal({ type: "DIVIDEND_INCOME", targetValue: 2_400 }), facts, { now: NOW })
    expect(progress.current).toBe(1_200)
    expect(progress.progressPct).toBe(50)
  })

  it("TOTAL_RETURN measures a percentage and needs no currency", () => {
    const progress = goalProgress(
      goal({ type: "TOTAL_RETURN", targetValue: 25, currency: null, targetDate: null }),
      facts,
      { now: NOW },
    )
    expect(progress).toMatchObject({ current: 12.5, progressPct: 50, unit: "percent", currency: null })
    expect(progress.daysRemaining).toBeNull()
  })

  it("covers every declared goal type", () => {
    for (const type of GOAL_TYPES) {
      const g = goal({ type, targetValue: 100, currency: type === "TOTAL_RETURN" ? null : "USD" })
      expect(goalProgress(g, facts, { now: NOW }).type).toBe(type)
    }
  })
})

describe("achievement and overshoot", () => {
  it("marks a goal achieved once it is met", () => {
    const progress = goalProgress(goal({ targetValue: 40_000 }), facts, { now: NOW })
    expect(progress.achieved).toBe(true)
    expect(progress.remaining).toBe(0)
  })

  it("reports progress past 100% rather than capping it", () => {
    expect(goalProgress(goal({ targetValue: 25_000 }), facts, { now: NOW }).progressPct).toBe(200)
  })

  it("reports negative progress honestly rather than flattering the user", () => {
    const losing = { ...facts, returnPct: -8 }
    const progress = goalProgress(
      goal({ type: "TOTAL_RETURN", targetValue: 10, currency: null }),
      losing,
      { now: NOW },
    )
    expect(progress.progressPct).toBe(-80)
  })

  it("is null for a non-positive target — a goal of zero was never expressible", () => {
    expect(goalProgress(goal({ targetValue: 0 }), facts, { now: NOW }).progressPct).toBeNull()
  })
})

describe("target dates", () => {
  it("counts the days remaining", () => {
    expect(goalProgress(goal({ targetDate: "2026-09-12" }), facts, { now: NOW }).daysRemaining).toBe(10)
  })

  it("goes negative once the date has passed rather than hiding it", () => {
    expect(goalProgress(goal({ targetDate: "2026-08-02" }), facts, { now: NOW }).daysRemaining).toBe(-31)
  })
})

describe("multi-currency goals", () => {
  const convert = (amount: number, from: string) =>
    from === "THB" ? { value: amount / 32.45 } : { value: amount }

  it("converts the target into the portfolio's base currency", () => {
    const progress = goalProgress(goal({ currency: "THB", targetValue: 3_245_000 }), facts, {
      now: NOW,
      convert,
    })
    // ฿3,245,000 ÷ 32.45 = $100,000, so 50,000 of it is 50%.
    expect(progress.target).toBeCloseTo(100_000, 2)
    expect(progress.progressPct).toBeCloseTo(50, 2)
  })

  it("returns null progress and a reason when no rate exists — never a cross-currency comparison", () => {
    const progress = goalProgress(goal({ currency: "EUR", targetValue: 90_000 }), facts, {
      now: NOW,
      convert: () => null,
    })
    expect(progress.progressPct).toBeNull()
    expect(progress.remaining).toBeNull()
    expect(progress.achieved).toBe(false)
    expect(progress.unavailableReason).toContain("EUR")
  })

  it("needs no rate when the goal is already in the base currency", () => {
    const progress = goalProgress(goal(), facts, { now: NOW }) // no converter supplied at all
    expect(progress.progressPct).toBe(50)
  })

  it("needs no rate for a percentage goal", () => {
    const progress = goalProgress(
      goal({ type: "TOTAL_RETURN", targetValue: 25, currency: null }),
      { ...facts, baseCurrency: "THB" },
      { now: NOW },
    )
    expect(progress.progressPct).toBe(50)
  })
})

describe("average monthly contribution", () => {
  const flows = [
    { occurredOn: "2026-08-01", kind: "deposit" as const, amount: 1200 },
    { occurredOn: "2026-07-01", kind: "deposit" as const, amount: 1200 },
    { occurredOn: "2026-06-01", kind: "withdrawal" as const, amount: 400 },
  ]

  it("nets withdrawals against deposits over the window", () => {
    expect(averageMonthlyContribution(flows, { months: 12, now: NOW })).toBeCloseTo(2000 / 12, 2)
  })

  it("excludes movements outside the window", () => {
    const old = [{ occurredOn: "2020-01-01", kind: "deposit" as const, amount: 99_999 }]
    expect(averageMonthlyContribution(old, { months: 12, now: NOW })).toBeNull()
  })

  it("is null with no movements at all — 'we do not know' is not 'you contribute nothing'", () => {
    expect(averageMonthlyContribution([], { now: NOW })).toBeNull()
  })
})
