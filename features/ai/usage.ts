import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { serverEnv } from "@/lib/env.server"
import { AIError } from "@/services/ai/errors"
import type { AIUsage } from "@/services/ai/types"
import type { Database } from "@/types/database"

/**
 * Usage accounting: the daily quota, the cost estimate and the audit row.
 *
 * The quota is counted **in the database**, not in the in-memory limiter. `lib/rate-limit.ts` is
 * honest about being a brake rather than a control — each serverless instance keeps its own
 * counter and a cold start forgets everything — which is fine for "stop an accidental loop" and
 * useless for "this costs real money". A row per request is the only count that survives a deploy.
 *
 * Both limits are applied: the memory one stops a burst within a minute, the database one holds
 * the daily ceiling.
 */

/**
 * Published per-million-token prices, used only to estimate. An unknown model records `null` cost
 * rather than a guessed one — a made-up number in a cost report is worse than an admitted gap.
 */
const PRICE_PER_MILLION: Record<string, { input: number; output: number }> = {
  "claude-opus-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
}

export function estimateCost(model: string, usage: AIUsage): number | null {
  // Providers return dated or suffixed ids; match on the longest known prefix.
  const key = Object.keys(PRICE_PER_MILLION)
    .filter((id) => model.startsWith(id))
    .sort((a, b) => b.length - a.length)[0]
  if (!key) return null

  const price = PRICE_PER_MILLION[key]
  const cost = (usage.inputTokens * price.input + usage.outputTokens * price.output) / 1_000_000
  // Six decimal places, matching the column. A sub-microdollar request rounds to zero, which is
  // the truthful answer.
  return Math.round(cost * 1e6) / 1e6
}

/**
 * Rejects the request when the caller has spent their day's allowance.
 *
 * A rolling 24-hour window rather than a calendar day: it needs no timezone, no reset job, and no
 * argument about whose midnight counts.
 */
export async function assertWithinDailyQuota(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<{ used: number; limit: number }> {
  const limit = serverEnv.aiDailyLimit
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { count, error } = await supabase
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since)

  if (error) {
    // Failing open here would make the quota advisory. It is a spending limit, so it fails closed.
    console.error("[ai] quota read failed", error.code)
    throw AIError.unavailable(error.code)
  }

  const used = count ?? 0
  if (used >= limit) throw AIError.quotaExceeded(limit)
  return { used, limit }
}

export type UsageRecord = {
  userId: string
  provider: string
  model: string
  intent: string | null
  symbols: string[]
  usage: AIUsage
  latencyMs: number | null
  status: "ok" | "error"
  errorCode: string | null
}

/**
 * The audit and cost row.
 *
 * Recorded only once a provider call has actually been attempted — a request rejected by the flag,
 * the quota or validation cost nothing and does not consume the user's allowance.
 *
 * **The question text is not written here.** What the request was about (`intent`, `symbols`) is
 * what an audit needs; the words live in `ai_messages`, which the user can delete.
 */
export async function recordUsage(
  supabase: SupabaseClient<Database>,
  record: UsageRecord,
): Promise<void> {
  const { error } = await supabase.from("ai_usage").insert({
    user_id: record.userId,
    provider: record.provider,
    model: record.model,
    intent: record.intent,
    symbols: record.symbols,
    input_tokens: record.usage.inputTokens,
    output_tokens: record.usage.outputTokens,
    estimated_cost: estimateCost(record.model, record.usage),
    latency_ms: record.latencyMs,
    status: record.status,
    error_code: record.errorCode,
  })

  // Accounting must never take the answer away from the user: a failed insert is logged loudly and
  // the response still goes out.
  if (error) console.error("[ai] usage insert failed", error.code)
}
