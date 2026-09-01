import type { ZodType } from "zod"
import { AIError } from "./errors"
import type { AIProvider, AIStructuredRequest, AIStructuredResult, AIRequest, AIResult } from "./types"

/**
 * A provider that needs no account and no network.
 *
 * It exists for the same reason `mockMarketDataProvider` does: the whole feature — routes, schema
 * validation, usage accounting, the chat UI — has to be runnable and testable without buying
 * tokens. Its replies are deterministic, which is what lets a test assert that the numbers on
 * screen came from Stockly's engines rather than from the model.
 *
 * It is honest about being a mock. It never pretends to have analysed anything.
 */

const NOTICE =
  "Stockly AI is running with the mock provider, so this narrative is a fixed placeholder. " +
  "Every figure shown beside it is real: it comes from Stockly's own indicator, portfolio and " +
  "market-data engines, not from a language model."

/** Matches the narrative schema in features/ai/schema.ts. A test keeps the two in step. */
const MOCK_NARRATIVE = {
  summary: NOTICE,
  interpretation:
    "Configure AI_PROVIDER and AI_API_KEY to get a written interpretation of the data below.",
  positives: ["The retrieved data is shown in full beside this text."],
  risks: ["No language model was called, so nothing here is an analysis."],
  notes: "Mock provider — set AI_PROVIDER to anthropic or openai for a real answer.",
}

/** Matches the screener-filter schema. "Strong momentum" as Stockly's own preset defines it. */
const MOCK_FILTERS = {
  definition: {
    logic: "AND",
    filters: [
      { metric: "RSI", operator: "GTE", value: 50 },
      { metric: "ADX", operator: "GTE", value: 25 },
      { metric: "RELATIVE_VOLUME", operator: "GTE", value: 1.5 },
    ],
    sort: { metric: "TECHNICAL_SCORE", direction: "desc" },
  },
  explanation:
    "Mock provider: a fixed momentum screen — RSI at or above 50, ADX at or above 25, and volume " +
    "at least 1.5× its average.",
}

const MOCK_BY_SCHEMA: Record<string, unknown> = {
  narrative: MOCK_NARRATIVE,
  "screener-filters": MOCK_FILTERS,
}

export const mockAIProvider: AIProvider = {
  name: "mock",
  model: "mock",

  async generate(request: AIRequest): Promise<AIResult> {
    const question = request.messages.at(-1)?.content ?? ""
    return {
      text: `${NOTICE}\n\nYou asked: ${question}`,
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "mock",
      provider: "mock",
      latencyMs: 0,
    }
  },

  async generateStructured<T>(
    request: AIStructuredRequest,
    schema: ZodType<T>,
  ): Promise<AIStructuredResult<T>> {
    const fixture = MOCK_BY_SCHEMA[request.schemaName]
    if (fixture === undefined) {
      throw AIError.invalidResponse(`The mock provider has no fixture for "${request.schemaName}".`)
    }
    // Validated exactly like a real reply: if a schema changes and the fixture does not, this
    // throws in tests rather than shipping a shape the UI cannot render.
    return {
      text: JSON.stringify(fixture),
      usage: { inputTokens: 0, outputTokens: 0 },
      model: "mock",
      provider: "mock",
      latencyMs: 0,
      data: schema.parse(fixture),
    }
  },
}
