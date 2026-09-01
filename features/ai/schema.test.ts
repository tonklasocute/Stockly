import { describe, expect, it } from "vitest"
import { mockAIProvider } from "@/services/ai/mock-provider"
import {
  aiChatSchema,
  MAX_QUESTION_LENGTH,
  narrativeSchema,
  proposedScreenSchema,
  NARRATIVE_HINT,
  PROPOSED_SCREEN_HINT,
} from "./schema"

/**
 * A language model's output is untrusted input arriving from the other direction. These are the
 * same kind of tests a request body gets.
 */

const validNarrative = {
  summary: "NVDA is trading above its 200 EMA with an ADX of 31.",
  interpretation: "Trend and momentum readings are both positive.",
  positives: ["Price above the 200 EMA"],
  risks: ["ATR is 4.6% of price"],
  notes: null,
}

describe("narrativeSchema", () => {
  it("accepts a well-formed narrative", () => {
    expect(narrativeSchema.parse(validNarrative)).toMatchObject({ summary: validNarrative.summary })
  })

  it("fills in the optional fields so the UI never renders undefined", () => {
    const parsed = narrativeSchema.parse({ summary: "Just a summary." })
    expect(parsed.positives).toEqual([])
    expect(parsed.risks).toEqual([])
    expect(parsed.notes).toBeNull()
    expect(parsed.interpretation).toBe("")
  })

  it("rejects a missing summary", () => {
    expect(narrativeSchema.safeParse({ interpretation: "hello" }).success).toBe(false)
  })

  it("rejects wrong types", () => {
    expect(narrativeSchema.safeParse({ ...validNarrative, summary: 42 }).success).toBe(false)
    expect(narrativeSchema.safeParse({ ...validNarrative, risks: "one risk" }).success).toBe(false)
    expect(
      narrativeSchema.safeParse({ ...validNarrative, positives: [{ text: "no" }] }).success,
    ).toBe(false)
  })

  it("caps the list lengths and the text lengths", () => {
    expect(
      narrativeSchema.safeParse({ ...validNarrative, risks: Array(9).fill("a risk") }).success,
    ).toBe(false)
    expect(
      narrativeSchema.safeParse({ ...validNarrative, summary: "x".repeat(5000) }).success,
    ).toBe(false)
  })

  it("has no field for a price, a score or any other figure", () => {
    // The grounding design in one assertion: the model is never asked for a number, so it cannot
    // return one that disagrees with Stockly's engines.
    const keys = Object.keys(narrativeSchema.shape)
    expect(keys).toEqual(["summary", "interpretation", "positives", "risks", "notes"])
  })
})

describe("proposedScreenSchema", () => {
  const valid = {
    definition: {
      logic: "AND",
      filters: [{ metric: "RSI", operator: "GTE", value: 50 }],
    },
    explanation: "Momentum above the midpoint.",
  }

  it("accepts filters built from the closed enums", () => {
    expect(proposedScreenSchema.parse(valid).definition.filters).toHaveLength(1)
  })

  it("rejects a metric the engine does not know", () => {
    const result = proposedScreenSchema.safeParse({
      ...valid,
      definition: { logic: "AND", filters: [{ metric: "SECRET_SAUCE", operator: "GT", value: 1 }] },
    })
    expect(result.success).toBe(false)
  })

  it("rejects an operator the engine does not know", () => {
    const result = proposedScreenSchema.safeParse({
      ...valid,
      definition: { logic: "AND", filters: [{ metric: "RSI", operator: "REGEX", value: 1 }] },
    })
    expect(result.success).toBe(false)
  })

  it("rejects a value that is an expression, an object or an array", () => {
    for (const value of ["'; drop table users; --", "RSI * 2", { $gt: 1 }, ["a"], null]) {
      const result = proposedScreenSchema.safeParse({
        ...valid,
        definition: { logic: "AND", filters: [{ metric: "RSI", operator: "GT", value }] },
      })
      expect(result.success).toBe(false)
    }
  })

  it("whatever survives validation is a number or a trend name, never a string to interpret", () => {
    // The screener schema coerces, because the hand-built editor sends numbers as form strings.
    // What matters is that the output type is closed: nothing the engine could evaluate.
    const parsed = proposedScreenSchema.parse({
      ...valid,
      definition: {
        logic: "AND",
        filters: [
          { metric: "RSI", operator: "GT", value: "55" },
          { metric: "TREND", operator: "EQ", value: "bullish" },
        ],
      },
    })
    expect(parsed.definition.filters[0].value).toBe(55)
    expect(parsed.definition.filters[1].value).toBe("bullish")
  })

  it("caps the number of filters so a proposal cannot become unbounded work", () => {
    const filters = Array(11).fill({ metric: "RSI", operator: "GT", value: 1 })
    expect(
      proposedScreenSchema.safeParse({ ...valid, definition: { logic: "AND", filters } }).success,
    ).toBe(false)
  })
})

describe("aiChatSchema", () => {
  it("rejects an empty question and one past the length cap", () => {
    expect(aiChatSchema.safeParse({ question: "   " }).success).toBe(false)
    expect(aiChatSchema.safeParse({ question: "x".repeat(MAX_QUESTION_LENGTH + 1) }).success).toBe(false)
  })

  it("rejects a conversation id that is not a uuid", () => {
    expect(aiChatSchema.safeParse({ question: "hi", conversationId: "../../etc" }).success).toBe(false)
  })

  it("has no field for a user id — that always comes from the session", () => {
    expect(Object.keys(aiChatSchema.shape)).not.toContain("userId")
  })
})

describe("the mock provider's fixtures still match the schemas", () => {
  it("returns a narrative the schema accepts", async () => {
    const result = await mockAIProvider.generateStructured(
      { system: "s", messages: [], schemaName: "narrative", schemaHint: NARRATIVE_HINT },
      narrativeSchema,
    )
    expect(result.data.summary.length).toBeGreaterThan(0)
  })

  it("returns a screen proposal the schema accepts", async () => {
    const result = await mockAIProvider.generateStructured(
      { system: "s", messages: [], schemaName: "screener-filters", schemaHint: PROPOSED_SCREEN_HINT },
      proposedScreenSchema,
    )
    expect(result.data.definition.filters.length).toBeGreaterThan(0)
  })

  it("refuses a schema it has no fixture for, rather than inventing one", async () => {
    await expect(
      mockAIProvider.generateStructured(
        { system: "s", messages: [], schemaName: "unknown", schemaHint: "{}" },
        narrativeSchema,
      ),
    ).rejects.toMatchObject({ code: "AI_INVALID_RESPONSE" })
  })
})
