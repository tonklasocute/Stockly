import { beforeEach, describe, expect, it, vi } from "vitest"
import EN_AI from "@/locales/en/ai.json"
import TH_AI from "@/locales/th/ai.json"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import type { AIContext } from "./context"
import type { GroundedData } from "./facts"
import type { AIRequest, AIStructuredRequest } from "@/services/ai/types"

/**
 * The orchestrator end to end: question in, retrieval, provider call, validation, safety check,
 * accounting, structured result out.
 *
 * Retrieval and the database are stubbed at their own module boundaries — what is under test here
 * is the wiring: that the question never becomes an instruction, that the grounded data passes
 * through untouched, and that a non-compliant reply is caught rather than published.
 */

const grounded: GroundedData = {
  stocks: [],
  portfolio: null,
  watchlist: null,
  market: null,
  screen: null,
  unknownSymbols: [],
  marketDataError: null,
}

const context: AIContext = {
  intent: "STOCK_ANALYSIS",
  symbols: ["NVDA"],
  grounded,
  completeness: { coveragePct: 100, level: "high", available: [{ code: "price", symbol: "NVDA" }], missing: [] },
  dataAsOf: "2026-09-01T10:30:00Z",
  delayed: false,
  text: "### NVDA\nRSI (14): 58.4\nTechnical score: 78/100 (v1)",
}

const seen: { requests: (AIRequest | AIStructuredRequest)[] } = { requests: [] }
let replies: unknown[] = []
const usageRows: { status: string; errorCode: string | null }[] = []

vi.mock("./context", () => ({
  buildContext: vi.fn(async () => context),
  resolveKnownSymbols: vi.fn(async () => new Set(["NVDA", "AMD"])),
}))

vi.mock("./usage", () => ({
  assertWithinDailyQuota: vi.fn(async () => ({ used: 0, limit: 25 })),
  recordUsage: vi.fn(async (_client: unknown, record: { status: string; errorCode: string | null }) => {
    usageRows.push({ status: record.status, errorCode: record.errorCode })
  }),
}))

vi.mock("@/services/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/ai")>()
  return {
    ...actual,
    isAIEnabled: () => true,
    getAIProvider: () => ({
      name: "stub",
      model: "stub-model",
      generate: async () => {
        throw new Error("not used")
      },
      generateStructured: async (request: AIStructuredRequest) => {
        seen.requests.push(request)
        const data = replies.shift() ?? replies[0]
        return {
          text: JSON.stringify(data),
          usage: { inputTokens: 100, outputTokens: 40 },
          model: "stub-model",
          provider: "stub",
          latencyMs: 5,
          data,
        }
      },
    }),
  }
})

const { runResearch } = await import("./research-service")

const supabase = {} as SupabaseClient<Database>
const clean = {
  summary: "NVDA is above its 200 EMA with an RSI of 58.4.",
  interpretation: "Trend and momentum readings are both positive.",
  positives: ["Price above the 200 EMA"],
  risks: [],
  notes: null,
}

beforeEach(() => {
  seen.requests = []
  usageRows.length = 0
  replies = [clean]
  vi.spyOn(console, "info").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("runResearch", () => {
  it("returns the narrative alongside untouched grounded data", async () => {
    const result = await runResearch({
      supabase,
      userId: "u1",
      question: "analyse NVDA",
    })

    expect(result.intent).toBe("STOCK_ANALYSIS")
    expect(result.symbols).toEqual(["NVDA"])
    expect(result.narrative.summary).toBe(clean.summary)
    // The figures are the ones retrieval produced, byte for byte.
    expect(result.grounded).toBe(grounded)
    expect(result.dataAsOf).toBe(context.dataAsOf)
    expect(result.safetyFiltered).toBe(false)
  })

  it("puts the retrieved data and the rules in the system prompt, and the question in a user turn", async () => {
    await runResearch({ supabase, userId: "u1", question: "analyse NVDA" })

    const request = seen.requests[0] as AIStructuredRequest
    expect(request.system).toContain("STOCKLY DATA")
    expect(request.system).toContain("Technical score: 78/100")
    expect(request.system).toContain("Never tell anyone to buy")
    // The user's words are a turn, never part of the instructions.
    expect(request.system).not.toContain("analyse NVDA")
    expect(request.messages.at(-1)).toEqual({ role: "user", content: "analyse NVDA" })
  })

  it("only sends the earlier turns it was given", async () => {
    await runResearch({
      supabase,
      userId: "u1",
      question: "and AMD?",
      history: [{ role: "user", content: "analyse NVDA" }],
    })
    expect(seen.requests[0].messages).toHaveLength(2)
  })

  it("drops a caller-supplied symbol that is not in the universe", async () => {
    const result = await runResearch({
      supabase,
      userId: "u1",
      question: "analyse this",
      forceIntent: "STOCK_ANALYSIS",
      forceSymbols: ["NVDA", "ABCXYZ"],
    })
    expect(result.symbols).toEqual(["NVDA"])
  })

  it("rewrites once when a reply breaks the safety vocabulary", async () => {
    replies = [{ ...clean, summary: "You should buy NVDA now." }, clean]

    const result = await runResearch({ supabase, userId: "u1", question: "analyse NVDA" })

    expect(seen.requests).toHaveLength(2)
    expect(seen.requests[1].system).toContain("advice, rating or prediction language")
    expect(result.safetyFiltered).toBe(false)
    expect(result.narrative.summary).toBe(clean.summary)
  })

  it("withholds the text — but not the data — when the rewrite is still non-compliant", async () => {
    const bad = { ...clean, summary: "This is a strong buy and the price will definitely rise." }
    replies = [bad, bad]

    const result = await runResearch({ supabase, userId: "u1", question: "analyse NVDA" })

    /*
     * `safetyFiltered` is the whole of the claim, and the narrative is *empty* rather than a
     * replacement sentence — phase 21 moved the withheld wording into the `ai` namespace so it
     * exists in both languages. What must never happen is the model's non-compliant text surviving,
     * and that is what the emptiness guarantees.
     */
    expect(result.safetyFiltered).toBe(true)
    expect(result.narrative.summary).toBe("")
    expect(JSON.stringify(result.narrative)).not.toContain("strong buy")
    expect(EN_AI.notCompliant).toMatch(/withheld/i)
    expect(TH_AI.notCompliant.length).toBeGreaterThan(20)
    expect(result.grounded).toBe(grounded)
  })

  it("records a usage row on success and on failure", async () => {
    await runResearch({ supabase, userId: "u1", question: "analyse NVDA" })
    expect(usageRows).toEqual([{ status: "ok", errorCode: null }])

    usageRows.length = 0
    replies = []
    // An empty reply queue makes the stub return undefined, which fails schema validation.
    await expect(runResearch({ supabase, userId: "u1", question: "analyse NVDA" })).rejects.toThrow()
    expect(usageRows[0].status).toBe("error")
  })
})
