import { afterEach, describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"
import { assertWithinDailyQuota, estimateCost, recordUsage } from "./usage"

/**
 * The daily limit and the cost ledger.
 *
 * These are the controls that actually hold: the in-memory limiter in lib/rate-limit.ts forgets
 * everything on a cold start and counts per instance, which is fine for stopping a runaway loop and
 * useless for a spending cap.
 */

type Stub = { count: number | null; error: { code: string } | null }

/** The narrow slice of the Supabase client this module uses. */
function stubClient(select: Stub, onInsert?: (row: Record<string, unknown>) => void) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          gte: () => Promise.resolve(select),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        onInsert?.(row)
        return Promise.resolve({ error: null })
      },
    }),
  } as unknown as SupabaseClient<Database>
}

afterEach(() => {
  delete process.env.AI_DAILY_LIMIT
  vi.restoreAllMocks()
})

describe("estimateCost", () => {
  it("prices a known model from its published rate", () => {
    // 1M input at $5 plus 1M output at $25.
    expect(
      estimateCost("claude-opus-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toBe(30)
  })

  it("matches a dated or suffixed model id by its prefix", () => {
    expect(estimateCost("claude-sonnet-5-20260101", { inputTokens: 1_000_000, outputTokens: 0 })).toBe(2)
  })

  it("returns null for an unknown model rather than guessing a price", () => {
    expect(estimateCost("some-local-model", { inputTokens: 1000, outputTokens: 1000 })).toBeNull()
    expect(estimateCost("mock", { inputTokens: 0, outputTokens: 0 })).toBeNull()
  })

  it("rounds to the six decimal places the column stores", () => {
    const cost = estimateCost("claude-opus-5", { inputTokens: 1, outputTokens: 1 })!
    expect(cost).toBe(Math.round(cost * 1e6) / 1e6)
  })
})

describe("assertWithinDailyQuota", () => {
  it("allows a user below the limit and reports what they have used", async () => {
    process.env.AI_DAILY_LIMIT = "25"
    await expect(assertWithinDailyQuota(stubClient({ count: 3, error: null }), "u1")).resolves.toEqual({
      used: 3,
      limit: 25,
    })
  })

  it("rejects at the limit, before any provider call is made", async () => {
    process.env.AI_DAILY_LIMIT = "10"
    await expect(
      assertWithinDailyQuota(stubClient({ count: 10, error: null }), "u1"),
    ).rejects.toMatchObject({ code: "AI_QUOTA_EXCEEDED" })
  })

  it("fails closed when the count cannot be read — a spending cap is not advisory", async () => {
    await expect(
      assertWithinDailyQuota(stubClient({ count: null, error: { code: "PGRST000" } }), "u1"),
    ).rejects.toMatchObject({ code: "AI_UNAVAILABLE" })
  })
})

describe("recordUsage", () => {
  it("writes tokens, latency and an estimated cost — and no prompt text", async () => {
    let written: Record<string, unknown> | null = null
    await recordUsage(stubClient({ count: 0, error: null }, (row) => (written = row)), {
      userId: "u1",
      provider: "anthropic",
      model: "claude-opus-5",
      intent: "STOCK_ANALYSIS",
      symbols: ["NVDA"],
      usage: { inputTokens: 1200, outputTokens: 300 },
      latencyMs: 2400,
      status: "ok",
      errorCode: null,
    })

    const row = written as unknown as Record<string, unknown>
    expect(row.input_tokens).toBe(1200)
    expect(row.output_tokens).toBe(300)
    expect(row.latency_ms).toBe(2400)
    expect(row.estimated_cost).toBeGreaterThan(0)
    expect(row.symbols).toEqual(["NVDA"])
    // The audit row records what the request was about, never what was said.
    expect(Object.keys(row)).not.toContain("question")
    expect(Object.keys(row)).not.toContain("prompt")
  })

  it("never throws — accounting must not take the answer away from the user", async () => {
    const failing = {
      from: () => ({ insert: () => Promise.resolve({ error: { code: "23505" } }) }),
    } as unknown as SupabaseClient<Database>
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      recordUsage(failing, {
        userId: "u1",
        provider: "mock",
        model: "mock",
        intent: null,
        symbols: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 1,
        status: "ok",
        errorCode: null,
      }),
    ).resolves.toBeUndefined()
  })
})
