import { describe, expect, it } from "vitest"
import { findForbiddenPattern } from "./insights"
import {
  JOURNAL_TYPES,
  MAX_CONVICTION,
  MIN_CONVICTION,
  SELL_REASONS,
  THESIS_REVIEW_AFTER_DAYS,
  THESIS_STATUSES,
  daysSinceReview,
  isValidConviction,
  thesisObservations,
  type ThesisContext,
} from "./research"

const NOW = new Date("2026-09-02T12:00:00Z")

const context = (over: Partial<ThesisContext> = {}): ThesisContext => ({
  returnPct: 5,
  weightPct: 8,
  quantity: 100,
  updatedAt: "2026-08-01T00:00:00Z",
  ...over,
})

describe("conviction", () => {
  it("accepts whole numbers in range and nothing else", () => {
    expect(isValidConviction(MIN_CONVICTION)).toBe(true)
    expect(isValidConviction(MAX_CONVICTION)).toBe(true)
    expect(isValidConviction(0)).toBe(false)
    expect(isValidConviction(11)).toBe(false)
    expect(isValidConviction(7.5)).toBe(false)
    expect(isValidConviction(Number.NaN)).toBe(false)
  })
})

describe("enums", () => {
  it("declares the statuses, journal types and sell reasons the schema constrains", () => {
    expect(THESIS_STATUSES).toContain("BROKEN")
    expect(THESIS_STATUSES).toContain("ACTIVE")
    expect(JOURNAL_TYPES).toContain("SELL_REASON")
    expect(SELL_REASONS).toContain("THESIS_BROKEN")
  })
})

describe("days since review", () => {
  it("counts whole days and never goes negative", () => {
    expect(daysSinceReview("2026-08-31T12:00:00Z", NOW)).toBe(2)
    expect(daysSinceReview("2026-09-10T00:00:00Z", NOW)).toBe(0)
  })

  it("is null for a timestamp it cannot read", () => {
    expect(daysSinceReview("not a date", NOW)).toBeNull()
  })
})

describe("thesis observations", () => {
  it("says nothing about an ordinary position", () => {
    expect(thesisObservations(context(), NOW)).toEqual([])
  })

  it("states a decline as a measurement", () => {
    const [observation] = thesisObservations(context({ returnPct: -18.4 }), NOW)
    expect(observation.code).toBe("DRAWDOWN_FROM_COST")
    expect(observation.text).toBe("The position is 18.4% below its cost basis.")
  })

  it("states a gain the same way", () => {
    expect(thesisObservations(context({ returnPct: 31 }), NOW)[0].code).toBe("GAIN_FROM_COST")
  })

  it("notes when the position has been closed", () => {
    expect(thesisObservations(context({ quantity: 0 }), NOW)[0].code).toBe("POSITION_CLOSED")
  })

  it("notes a position that has grown into a large share of the portfolio", () => {
    expect(thesisObservations(context({ weightPct: 34 }), NOW).map((o) => o.code)).toContain("WEIGHT_GREW")
  })

  it("offers a review once the thesis is old, without expiring it", () => {
    const old = new Date(NOW.getTime() + (THESIS_REVIEW_AFTER_DAYS + 1) * 86_400_000)
    const observations = thesisObservations(context(), old)
    expect(observations.map((o) => o.code)).toContain("STALE_REVIEW")
  })

  it("says nothing when a figure is unavailable rather than assuming zero", () => {
    expect(thesisObservations(context({ returnPct: null, weightPct: null }), NOW)).toEqual([])
  })

  /**
   * The most important test in this file. A system that concluded a thesis had failed would be
   * making a sell recommendation with extra steps — so every sentence it can put beside a thesis is
   * held to the same vocabulary rule the insights engine is.
   */
  it("never tells the user what their thesis means or what to do about it", () => {
    const extremes = [
      context({ returnPct: -80, weightPct: 95, quantity: 0, updatedAt: "2020-01-01T00:00:00Z" }),
      context({ returnPct: 400, weightPct: 60 }),
    ]
    for (const c of extremes) {
      for (const observation of thesisObservations(c, NOW)) {
        expect(findForbiddenPattern(observation.text), observation.text).toBeNull()
      }
    }
  })

  it("never claims a thesis is broken — only the user sets that", () => {
    const texts = thesisObservations(
      context({ returnPct: -60, weightPct: 70, quantity: 0 }),
      NOW,
    ).map((o) => o.text.toLowerCase())
    expect(texts.some((t) => t.includes("broken"))).toBe(false)
    expect(texts.some((t) => t.includes("invalid"))).toBe(false)
  })
})
