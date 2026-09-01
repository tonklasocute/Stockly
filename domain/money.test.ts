import { describe, expect, it } from "vitest"
import {
  add,
  divide,
  multiply,
  percentOf,
  quantize,
  roundTo,
  subtract,
  sum,
  sumBy,
  QUANTITY_SCALE,
} from "./money"

describe("float drift", () => {
  it("adds the textbook case exactly", () => {
    expect(add(0.1, 0.2)).toBe(0.3)
    // The whole reason this module exists.
    expect(0.1 + 0.2).not.toBe(0.3)
  })

  it("does not accumulate error across a thousand rows", () => {
    const cents = Array.from({ length: 1000 }, () => 0.01)
    expect(sum(cents)).toBe(10)
    expect(cents.reduce((a, b) => a + b, 0)).not.toBe(10)
  })

  it("returns exactly zero when a position nets out", () => {
    expect(sum([1234.56, -1000.12, -234.44])).toBe(0)
    expect(Object.is(sum([0.3, -0.1, -0.2]), 0)).toBe(true)
  })

  it("keeps a realistic transaction total clean", () => {
    // 10 @ 170.15 + 5 @ 180.05 + fees
    expect(sum([1701.5, 900.25, 1.5, 1.5])).toBe(2604.75)
  })
})

describe("quantize", () => {
  it("snaps dust to the grid", () => {
    expect(quantize(0.30000000000000004)).toBe(0.3)
  })

  it("keeps eight decimal places for quantities", () => {
    expect(quantize(0.00000001, QUANTITY_SCALE)).toBe(0.00000001)
  })

  it("treats a non-finite value as zero rather than propagating NaN", () => {
    expect(quantize(NaN)).toBe(0)
    expect(quantize(Infinity)).toBe(0)
  })
})

describe("sum and sumBy", () => {
  it("ignores non-finite entries instead of poisoning the total", () => {
    expect(sum([1, NaN, 2, Infinity])).toBe(3)
  })

  it("sums an empty list to zero", () => {
    expect(sum([])).toBe(0)
  })

  it("sums a projection", () => {
    expect(sumBy([{ v: 0.1 }, { v: 0.2 }], (x) => x.v)).toBe(0.3)
  })
})

describe("arithmetic", () => {
  it("subtracts without drift", () => {
    expect(subtract(0.3, 0.1)).toBe(0.2)
  })

  it("multiplies quantity by price cleanly", () => {
    expect(multiply(3, 0.1)).toBe(0.3)
    expect(multiply(1.1, 1.1)).toBe(1.21)
  })

  it("divides, and refuses to return Infinity", () => {
    expect(divide(1, 3)).toBe(0.333333)
    expect(divide(1, 0)).toBe(0)
  })
})

describe("percentOf", () => {
  it("computes a percentage", () => {
    expect(percentOf(50, 200)).toBe(25)
  })

  it("is null on a zero base, because that is not a zero return", () => {
    expect(percentOf(10, 0)).toBeNull()
  })
})

describe("roundTo", () => {
  it("rounds half away from zero in both directions", () => {
    expect(roundTo(2.345, 2)).toBe(2.35)
    expect(roundTo(-2.345, 2)).toBe(-2.35)
  })

  it("rounds to whole units", () => {
    expect(roundTo(1234.56, 0)).toBe(1235)
  })
})
