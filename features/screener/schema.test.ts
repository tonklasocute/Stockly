import { describe, expect, it } from "vitest"
import { savedScreenSchema, screenerDefinitionSchema, screenerRunSchema } from "./schema"

const valid = { logic: "AND", filters: [{ metric: "RSI", operator: "LT", value: 30 }] }

describe("screener definition validation", () => {
  it("accepts a well-formed screen", () => {
    expect(screenerDefinitionSchema.safeParse(valid).success).toBe(true)
  })

  it("defaults the logic to AND", () => {
    const parsed = screenerDefinitionSchema.parse({ filters: [] })
    expect(parsed.logic).toBe("AND")
  })

  it("caps the number of filters", () => {
    const many = { logic: "AND", filters: new Array(11).fill(valid.filters[0]) }
    expect(screenerDefinitionSchema.safeParse(many).success).toBe(false)
  })
})

describe("injection attempts", () => {
  it("rejects an unknown metric", () => {
    const attack = { logic: "AND", filters: [{ metric: "RSI; DROP TABLE alerts", operator: "LT", value: 1 }] }
    expect(screenerDefinitionSchema.safeParse(attack).success).toBe(false)
  })

  it("rejects an unknown operator", () => {
    const attack = { logic: "AND", filters: [{ metric: "RSI", operator: "OR 1=1", value: 1 }] }
    expect(screenerDefinitionSchema.safeParse(attack).success).toBe(false)
  })

  it("rejects an SQL fragment as a value", () => {
    const attack = { logic: "AND", filters: [{ metric: "RSI", operator: "LT", value: "1 OR 1=1" }] }
    expect(screenerDefinitionSchema.safeParse(attack).success).toBe(false)
  })

  it("rejects a JavaScript expression as a value", () => {
    const attack = {
      logic: "AND",
      filters: [{ metric: "RSI", operator: "LT", value: "process.exit(1)" }],
    }
    expect(screenerDefinitionSchema.safeParse(attack).success).toBe(false)
  })

  it("rejects a raw expression field, because no such field exists", () => {
    const attack = { logic: "AND", filters: [], expression: "price > 100" }
    const parsed = screenerDefinitionSchema.safeParse(attack)
    // Even when the object parses, the unknown key is dropped: there is nothing to execute.
    expect(parsed.success && "expression" in parsed.data).toBe(false)
  })

  it("rejects a non-finite value", () => {
    expect(
      screenerDefinitionSchema.safeParse({
        logic: "AND",
        filters: [{ metric: "RSI", operator: "LT", value: Number.POSITIVE_INFINITY }],
      }).success,
    ).toBe(false)
  })

  it("rejects an absurd value that could only be an abuse attempt", () => {
    expect(
      screenerDefinitionSchema.safeParse({
        logic: "AND",
        filters: [{ metric: "PRICE", operator: "GT", value: 1e20 }],
      }).success,
    ).toBe(false)
  })

  it("only accepts the three trend names for a trend filter", () => {
    expect(
      screenerDefinitionSchema.safeParse({
        logic: "AND",
        filters: [{ metric: "TREND", operator: "EQ", value: "bullish" }],
      }).success,
    ).toBe(true)
    expect(
      screenerDefinitionSchema.safeParse({
        logic: "AND",
        filters: [{ metric: "TREND", operator: "EQ", value: "__proto__" }],
      }).success,
    ).toBe(false)
  })
})

describe("run request", () => {
  it("defaults to the first page", () => {
    expect(screenerRunSchema.parse({ definition: valid }).page).toBe(1)
  })

  it("caps how deep a page request can go", () => {
    expect(screenerRunSchema.safeParse({ definition: valid, page: 5000 }).success).toBe(false)
  })

  it("rejects a page below one", () => {
    expect(screenerRunSchema.safeParse({ definition: valid, page: 0 }).success).toBe(false)
  })
})

describe("saved screens", () => {
  it("requires a name", () => {
    expect(savedScreenSchema.safeParse({ name: "  ", definition: valid }).success).toBe(false)
  })

  it("caps the name length", () => {
    expect(savedScreenSchema.safeParse({ name: "x".repeat(61), definition: valid }).success).toBe(false)
  })

  it("validates the nested definition too", () => {
    const attack = { name: "ok", definition: { logic: "AND", filters: [{ metric: "evil", operator: "LT", value: 1 }] } }
    expect(savedScreenSchema.safeParse(attack).success).toBe(false)
  })
})
