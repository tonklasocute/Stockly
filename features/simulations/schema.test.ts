import { describe, expect, it } from "vitest"
import {
  MAX_SAVED_SIMULATIONS,
  growthInputSchema,
  savedSimulationSchema,
  savedSimulationUpdateSchema,
  whatIfInputSchema,
} from "./schema"

const PORTFOLIO_ID = "11111111-1111-4111-8111-111111111111"

const growth = {
  initialValue: 100_000,
  contribution: 10_000,
  frequency: "MONTHLY",
  annualReturnPct: 8,
  years: 10,
  currency: "THB",
}

describe("growth inputs", () => {
  it("accepts a scenario and defaults the optional assumptions", () => {
    const parsed = growthInputSchema.parse(growth)
    expect(parsed).toMatchObject({ contributionGrowthPct: 0, inflationPct: null })
  })

  it("keeps inflation null when it was not asked — not zero", () => {
    // Zero inflation is itself an assumption, and a wrong one to make on a user's behalf.
    expect(growthInputSchema.parse(growth).inflationPct).toBeNull()
    expect(growthInputSchema.parse({ ...growth, inflationPct: 0 }).inflationPct).toBe(0)
  })

  it("rejects a negative starting value or contribution", () => {
    expect(growthInputSchema.safeParse({ ...growth, initialValue: -1 }).success).toBe(false)
    expect(growthInputSchema.safeParse({ ...growth, contribution: -1 }).success).toBe(false)
  })

  it("bounds the horizon so a scenario stays informative", () => {
    expect(growthInputSchema.safeParse({ ...growth, years: 0 }).success).toBe(false)
    expect(growthInputSchema.safeParse({ ...growth, years: 51 }).success).toBe(false)
  })

  it("bounds the return so a fractional power stays real", () => {
    expect(growthInputSchema.safeParse({ ...growth, annualReturnPct: -101 }).success).toBe(false)
    expect(growthInputSchema.parse({ ...growth, annualReturnPct: -100 }).annualReturnPct).toBe(-100)
  })

  it("rejects an unknown currency and an unknown frequency", () => {
    expect(growthInputSchema.safeParse({ ...growth, currency: "BTC" }).success).toBe(false)
    expect(growthInputSchema.safeParse({ ...growth, frequency: "DAILY" }).success).toBe(false)
  })

  it("rejects a non-finite figure rather than letting NaN reach the engine", () => {
    expect(growthInputSchema.safeParse({ ...growth, initialValue: "abc" }).success).toBe(false)
    expect(growthInputSchema.safeParse({ ...growth, years: Number.POSITIVE_INFINITY }).success).toBe(false)
  })
})

describe("what-if inputs", () => {
  it("defaults to a scenario that changes nothing", () => {
    expect(whatIfInputSchema.parse({})).toEqual({
      cashDelta: 0,
      priceAdjustments: [],
      quantityAdjustments: [],
      fxOverrides: {},
    })
  })

  it("normalises a symbol and validates its market", () => {
    const parsed = whatIfInputSchema.parse({
      priceAdjustments: [{ symbol: " ptt ", market: "SET", changePct: 5 }],
    })
    expect(parsed.priceAdjustments[0].symbol).toBe("PTT")
    expect(
      whatIfInputSchema.safeParse({
        priceAdjustments: [{ symbol: "PTT", market: "XETRA" }],
      }).success,
    ).toBe(false)
  })

  it("caps the number of adjustments, so one scenario cannot become unbounded work", () => {
    const many = Array.from({ length: 51 }, () => ({ symbol: "A", market: "US" as const }))
    expect(whatIfInputSchema.safeParse({ priceAdjustments: many }).success).toBe(false)
  })

  it("rejects a non-positive exchange rate", () => {
    expect(whatIfInputSchema.safeParse({ fxOverrides: { THB: 0 } }).success).toBe(false)
    expect(whatIfInputSchema.safeParse({ fxOverrides: { THB: -1 } }).success).toBe(false)
    expect(whatIfInputSchema.parse({ fxOverrides: { THB: 32.45 } }).fxOverrides.THB).toBe(32.45)
  })

  it("rejects an unknown currency as an override key", () => {
    expect(whatIfInputSchema.safeParse({ fxOverrides: { BTC: 1 } }).success).toBe(false)
  })
})

describe("saved scenarios", () => {
  const saved = { portfolioId: PORTFOLIO_ID, name: "Retire at 50", type: "DCA", inputs: growth }

  it("accepts a scenario whose inputs match its type", () => {
    expect(savedSimulationSchema.parse(saved).name).toBe("Retire at 50")
  })

  it("rejects inputs that do not match the declared type", () => {
    // A DCA scenario carrying what-if adjustments is a document nothing could read back.
    const parsed = savedSimulationSchema.safeParse({
      ...saved,
      inputs: { cashDelta: 100, priceAdjustments: [] },
    })
    expect(parsed.success).toBe(false)
  })

  it("validates a goal scenario against the goal schema, which needs a target", () => {
    expect(savedSimulationSchema.safeParse({ ...saved, type: "GOAL" }).success).toBe(false)
    expect(
      savedSimulationSchema.safeParse({
        ...saved,
        type: "GOAL",
        inputs: { ...growth, targetValue: 5_000_000 },
      }).success,
    ).toBe(true)
  })

  it("requires a portfolio for a what-if scenario, which has nothing to start from without one", () => {
    const inputs = { cashDelta: 0, priceAdjustments: [], quantityAdjustments: [], fxOverrides: {} }
    expect(
      savedSimulationSchema.safeParse({ portfolioId: null, name: "x", type: "WHAT_IF", inputs })
        .success,
    ).toBe(false)
    expect(
      savedSimulationSchema.safeParse({ portfolioId: PORTFOLIO_ID, name: "x", type: "WHAT_IF", inputs })
        .success,
    ).toBe(true)
  })

  it("allows a standalone scenario with no portfolio at all", () => {
    expect(savedSimulationSchema.parse({ ...saved, portfolioId: null }).portfolioId).toBeNull()
  })

  it("rejects a blank or oversized name", () => {
    expect(savedSimulationSchema.safeParse({ ...saved, name: "   " }).success).toBe(false)
    expect(savedSimulationSchema.safeParse({ ...saved, name: "x".repeat(61) }).success).toBe(false)
  })

  it("rejects an unknown type", () => {
    expect(savedSimulationSchema.safeParse({ ...saved, type: "MONTE_CARLO" }).success).toBe(false)
  })

  it("rejects a portfolio id that is not a uuid, so an id cannot be smuggled in as text", () => {
    expect(savedSimulationSchema.safeParse({ ...saved, portfolioId: "1 OR 1=1" }).success).toBe(false)
  })

  it("allows a rename without resupplying the inputs", () => {
    expect(savedSimulationUpdateSchema.parse({ name: "New name" })).toEqual({ name: "New name" })
  })

  it("has no type field on update — the shape of the inputs depends on it", () => {
    const parsed = savedSimulationUpdateSchema.parse({ name: "x", type: "GOAL" })
    expect(parsed).not.toHaveProperty("type")
  })

  it("caps how many a user can keep", () => {
    expect(MAX_SAVED_SIMULATIONS).toBeGreaterThan(0)
  })
})
