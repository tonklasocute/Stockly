import { describe, expect, it } from "vitest"
import {
  moneyWeightedReturn,
  returnIndex,
  simpleReturn,
  subPeriodReturns,
  timeWeightedReturn,
  type ValuationPoint,
} from "./returns"

const point = (date: string, value: number, flow = 0): ValuationPoint => ({ date, value, flow })

describe("time-weighted return", () => {
  it("is the plain change when no money moved", () => {
    expect(timeWeightedReturn([point("2026-01-01", 100), point("2026-02-01", 110)])).toBeCloseTo(10, 6)
  })

  it("chains sub-periods geometrically", () => {
    // +10% then +10% is +21%, not +20%.
    const twr = timeWeightedReturn([
      point("2026-01-01", 100),
      point("2026-02-01", 110),
      point("2026-03-01", 121),
    ])
    expect(twr).toBeCloseTo(21, 6)
  })

  it("does not count a deposit as performance — the whole reason this exists", () => {
    // 100 in, 100 deposited, ends at 200. Nothing was earned.
    const twr = timeWeightedReturn([point("2026-01-01", 100), point("2026-02-01", 200, 100)])
    expect(twr).toBeCloseTo(0, 9)
  })

  it("does not count a withdrawal as a loss", () => {
    const twr = timeWeightedReturn([point("2026-01-01", 100), point("2026-02-01", 50, -50)])
    expect(twr).toBeCloseTo(0, 9)
  })

  it("separates a real gain from a simultaneous deposit", () => {
    // 100 grows to 110, then 100 is deposited: value 210, but the return is +10%.
    expect(timeWeightedReturn([point("2026-01-01", 100), point("2026-02-01", 210, 100)])).toBeCloseTo(10, 6)
  })

  it("is immune to when the money arrived", () => {
    // The same two 10% months, with a large deposit in different places. TWR must not move.
    const early = timeWeightedReturn([
      point("2026-01-01", 100),
      point("2026-02-01", 1110, 1000),
      point("2026-03-01", 1221),
    ])
    const late = timeWeightedReturn([
      point("2026-01-01", 100),
      point("2026-02-01", 110),
      point("2026-03-01", 1121, 1000),
    ])
    expect(early).toBeCloseTo(21, 6)
    expect(late).toBeCloseTo(21, 6)
  })

  it("reports a loss as a loss", () => {
    expect(timeWeightedReturn([point("2026-01-01", 100), point("2026-02-01", 80)])).toBeCloseTo(-20, 6)
  })

  it("sorts the points itself, so a caller cannot break it with an out-of-order series", () => {
    expect(
      timeWeightedReturn([point("2026-03-01", 121), point("2026-01-01", 100), point("2026-02-01", 110)]),
    ).toBeCloseTo(21, 6)
  })

  it("is null with fewer than two valuations — never 0", () => {
    expect(timeWeightedReturn([])).toBeNull()
    expect(timeWeightedReturn([point("2026-01-01", 100)])).toBeNull()
  })

  it("is null when a sub-period starts from nothing", () => {
    // You cannot divide by a portfolio that was worth zero, and skipping the period silently would
    // make the chain a return of something other than what it claims.
    expect(timeWeightedReturn([point("2026-01-01", 0), point("2026-02-01", 100, 100)])).toBeNull()
  })
})

describe("sub-period returns", () => {
  it("returns one entry per interval, with its endpoints named", () => {
    const returns = subPeriodReturns([
      point("2026-01-01", 100),
      point("2026-02-01", 110),
      point("2026-03-01", 121),
    ])
    expect(returns).toHaveLength(2)
    expect(returns![0]).toMatchObject({ from: "2026-01-01", to: "2026-02-01" })
    expect(returns![1].ratio).toBeCloseTo(0.1, 9)
  })
})

describe("return index", () => {
  it("starts at 1 and compounds the flow-adjusted returns", () => {
    const series = returnIndex([
      point("2026-01-01", 100),
      point("2026-02-01", 110),
      point("2026-03-01", 220, 99),
    ])
    expect(series![0]).toEqual({ date: "2026-01-01", index: 1 })
    expect(series![1].index).toBeCloseTo(1.1, 9)
    // The deposit is removed: 220 − 99 = 121 against 110 is +10%.
    expect(series![2].index).toBeCloseTo(1.21, 9)
  })

  it("is null when the series cannot produce returns", () => {
    expect(returnIndex([point("2026-01-01", 100)])).toBeNull()
  })
})

describe("money-weighted return (IRR)", () => {
  it("solves a simple one-year doubling", () => {
    const irr = moneyWeightedReturn([
      { date: "2026-01-01", amount: -100 },
      { date: "2027-01-01", amount: 200 },
    ])
    // 100.09%, not 100%: the day count is ACT/365.25 and a calendar year is 365 days. Asserted
    // loosely on purpose — pinning the exact figure would make this a test of the convention.
    expect(irr).toBeCloseTo(100, 0)
  })

  it("solves a flat year at zero", () => {
    const irr = moneyWeightedReturn([
      { date: "2026-01-01", amount: -100 },
      { date: "2027-01-01", amount: 100 },
    ])
    expect(irr).toBeCloseTo(0, 3)
  })

  it("accounts for when money arrived, unlike TWR", () => {
    // A late deposit that shared in the gain produces a different MWR than an early one.
    const late = moneyWeightedReturn([
      { date: "2026-01-01", amount: -100 },
      { date: "2026-11-01", amount: -100 },
      { date: "2027-01-01", amount: 230 },
    ])
    const early = moneyWeightedReturn([
      { date: "2026-01-01", amount: -200 },
      { date: "2027-01-01", amount: 230 },
    ])
    expect(late).not.toBeNull()
    expect(early).not.toBeNull()
    expect(late).not.toBeCloseTo(early!, 1)
  })

  it("is null when the flows never change sign — money only in has no return yet", () => {
    expect(
      moneyWeightedReturn([
        { date: "2026-01-01", amount: -100 },
        { date: "2026-06-01", amount: -100 },
      ]),
    ).toBeNull()
  })

  it("is null over too short a period to annualise honestly", () => {
    expect(
      moneyWeightedReturn([
        { date: "2026-01-01", amount: -100 },
        { date: "2026-01-05", amount: 110 },
      ]),
    ).toBeNull()
  })

  it("is null with fewer than two flows", () => {
    expect(moneyWeightedReturn([{ date: "2026-01-01", amount: -100 }])).toBeNull()
    expect(moneyWeightedReturn([])).toBeNull()
  })

  it("never returns NaN or Infinity for a hostile series", () => {
    const irr = moneyWeightedReturn([
      { date: "2026-01-01", amount: -1e-9 },
      { date: "2027-01-01", amount: 1e12 },
    ])
    expect(irr === null || Number.isFinite(irr)).toBe(true)
  })
})

describe("simple return", () => {
  it("is only for series with no capital flows", () => {
    expect(simpleReturn(100, 125)).toBeCloseTo(25, 6)
    expect(simpleReturn(0, 100)).toBeNull()
    expect(simpleReturn(-5, 100)).toBeNull()
  })
})
