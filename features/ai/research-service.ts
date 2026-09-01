import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  detectIntent,
  extractSymbols,
  findAdviceLanguage,
  type AIIntent,
  type DataCompleteness,
} from "@/domain/ai"
import { getAIProvider, isAIEnabled, AIError, isAIError, withRetry, type AIMessage } from "@/services/ai"
import type { Database, SavedScreenRow } from "@/types/database"
import { buildContext, resolveKnownSymbols, type GroundedData } from "./context"
import { renderScreenerVocabulary } from "./render"
import {
  narrativeSchema,
  proposedScreenSchema,
  NARRATIVE_HINT,
  PROPOSED_SCREEN_HINT,
  type Narrative,
  type ProposedScreen,
} from "./schema"
import { dataBlock, SAFETY_RETRY_NOTE, SCREENER_PROMPT, SYSTEM_PROMPT, TASK_PROMPTS } from "./prompts"
import { assertWithinDailyQuota, recordUsage } from "./usage"

/**
 * The orchestrator.
 *
 * Understand the question, resolve the symbols against a real universe, retrieve exactly what the
 * question needs, build the context, call the model, validate what comes back, check it against
 * the safety vocabulary, record what it cost, and return a structured result.
 *
 * The ordering matters: retrieval happens **before** the model is involved and the model never gets
 * a tool. It cannot query anything, so it cannot reach another user's data even if a question talks
 * it into trying. See docs/AI-ARCHITECTURE.md.
 */

export type AIResearchResult = {
  intent: AIIntent
  symbols: string[]
  /** The prose the model wrote — the only part of this object it authored. */
  narrative: Narrative
  /** Every figure, from Stockly's own engines. */
  grounded: GroundedData
  completeness: DataCompleteness
  dataAsOf: string
  delayed: boolean
  provider: string
  model: string
  /** True when a reply broke the safety vocabulary and was replaced. Shown to the user. */
  safetyFiltered: boolean
}

export type ResearchInput = {
  supabase: SupabaseClient<Database>
  userId: string
  question: string
  /** Prior turns, already capped by the caller. Only the text travels, never stored metadata. */
  history?: AIMessage[]
  /** Skips intent detection when the caller already knows — the stock page's Analyze button. */
  forceIntent?: AIIntent
  /** Pre-resolved symbols, for the same reason. Still validated against the universe. */
  forceSymbols?: string[]
  portfolioId?: string
  portfolioName?: string
  portfolioCurrency?: string
  savedScreens?: SavedScreenRow[]
}

/** The narrative used when the model cannot produce a compliant answer. Never a fabricated one. */
const WITHHELD_NARRATIVE: Narrative = {
  summary:
    "Stockly AI could not produce a compliant summary for this question, so the written analysis " +
    "has been withheld. The data below was still retrieved from Stockly's own engines and is " +
    "unaffected.",
  interpretation: "",
  positives: [],
  risks: [],
  notes: "The generated text used advice or prediction language, which Stockly does not publish.",
}

/**
 * Structured logging for an AI call.
 *
 * Records what happened, never what was said: no prompt, no answer, no key, no portfolio figure.
 * A log line that quotes a prompt is a copy of the user's data in a second place.
 */
function logCall(fields: Record<string, string | number | boolean | null>): void {
  console.info("[ai]", JSON.stringify(fields))
}

export async function runResearch(input: ResearchInput): Promise<AIResearchResult> {
  if (!isAIEnabled()) throw AIError.disabled()

  // The spending limit, before any work. A rejected request costs one indexed count query.
  await assertWithinDailyQuota(input.supabase, input.userId)

  const universe = await resolveKnownSymbols(input.supabase)
  const extracted = extractSymbols(input.question, universe)

  // A caller-supplied symbol still has to exist. "Trusted caller" is not a category here: the
  // stock page passes whatever is in the URL.
  const symbols = input.forceSymbols
    ? input.forceSymbols.filter((s) => universe.has(s))
    : extracted.symbols
  const unknown = input.forceSymbols
    ? input.forceSymbols.filter((s) => !universe.has(s))
    : extracted.unknown

  const intent = input.forceIntent ?? detectIntent(input.question, symbols.length)

  const context = await buildContext({
    supabase: input.supabase,
    intent,
    symbols,
    unknownSymbols: unknown,
    portfolioId: input.portfolioId,
    portfolioName: input.portfolioName,
    portfolioCurrency: input.portfolioCurrency,
    savedScreens: input.savedScreens,
  })

  const provider = getAIProvider()
  const system = `${SYSTEM_PROMPT}\n\n## Task\n${TASK_PROMPTS[intent]}${dataBlock(context.text)}`
  const messages: AIMessage[] = [
    ...(input.history ?? []),
    { role: "user", content: input.question },
  ]

  const startedAt = Date.now()
  let safetyFiltered = false

  try {
    let result = await withRetry(() =>
      provider.generateStructured(
        { system, messages, schemaName: "narrative", schemaHint: NARRATIVE_HINT },
        narrativeSchema,
      ),
    )

    // The safety vocabulary, checked rather than trusted. One rewrite, then the text is withheld —
    // the grounded data still goes out, because that part was never in question.
    let violations = violationsIn(result.data)
    if (violations.length > 0) {
      const retry = await provider.generateStructured(
        {
          system: `${system}\n\n## Correction\n${SAFETY_RETRY_NOTE}`,
          messages,
          schemaName: "narrative",
          schemaHint: NARRATIVE_HINT,
        },
        narrativeSchema,
      )
      result = {
        ...retry,
        usage: {
          inputTokens: result.usage.inputTokens + retry.usage.inputTokens,
          outputTokens: result.usage.outputTokens + retry.usage.outputTokens,
        },
      }
      violations = violationsIn(result.data)
    }

    if (violations.length > 0) {
      safetyFiltered = true
      console.warn("[ai] safety filter", JSON.stringify({ intent, violations }))
    }

    await recordUsage(input.supabase, {
      userId: input.userId,
      provider: result.provider,
      model: result.model,
      intent,
      symbols,
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
      status: "ok",
      errorCode: null,
    })

    logCall({
      event: "ai.request",
      intent,
      provider: result.provider,
      model: result.model,
      symbols: symbols.length,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      contextChars: context.text.length,
      coveragePct: context.completeness.coveragePct,
      delayed: context.delayed,
      safetyFiltered,
      status: "ok",
    })

    return {
      intent,
      symbols,
      narrative: safetyFiltered ? WITHHELD_NARRATIVE : result.data,
      grounded: context.grounded,
      completeness: context.completeness,
      dataAsOf: context.dataAsOf,
      delayed: context.delayed,
      provider: result.provider,
      model: result.model,
      safetyFiltered,
    }
  } catch (error) {
    const code = isAIError(error) ? error.code : "AI_UNAVAILABLE"
    await recordUsage(input.supabase, {
      userId: input.userId,
      provider: provider.name,
      model: provider.model,
      intent,
      symbols,
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorCode: code,
    })
    logCall({
      event: "ai.request",
      intent,
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorCode: code,
    })
    throw error
  }
}

function violationsIn(narrative: Narrative): string[] {
  const text = [
    narrative.summary,
    narrative.interpretation,
    ...narrative.positives,
    ...narrative.risks,
    narrative.notes ?? "",
  ].join("\n")
  return findAdviceLanguage(text)
}

// ---------------------------------------------------------------- natural-language screener

export type ProposedScreenResult = ProposedScreen & { provider: string; model: string }

/**
 * A sentence in, **a proposal out** — never a result.
 *
 * The model produces `{ metric, operator, value }` triples and nothing else. They are validated by
 * the same Zod schema and the same closed enums a hand-built screen goes through, then handed to
 * the user to review. Running the screen is a separate, deliberate action against the existing
 * screener endpoint, so the model never causes a query to execute.
 */
export async function proposeScreen(input: {
  supabase: SupabaseClient<Database>
  userId: string
  query: string
}): Promise<ProposedScreenResult> {
  if (!isAIEnabled()) throw AIError.disabled()
  await assertWithinDailyQuota(input.supabase, input.userId)

  const provider = getAIProvider()
  const system = `${SYSTEM_PROMPT}\n\n## Task\n${SCREENER_PROMPT}${dataBlock(renderScreenerVocabulary())}`

  const startedAt = Date.now()
  try {
    const result = await withRetry(() =>
      provider.generateStructured(
        {
          system,
          messages: [{ role: "user", content: input.query }],
          schemaName: "screener-filters",
          schemaHint: PROPOSED_SCREEN_HINT,
        },
        proposedScreenSchema,
      ),
    )

    await recordUsage(input.supabase, {
      userId: input.userId,
      provider: result.provider,
      model: result.model,
      intent: "SCREENER_TRANSLATION",
      symbols: [],
      usage: result.usage,
      latencyMs: Date.now() - startedAt,
      status: "ok",
      errorCode: null,
    })
    logCall({
      event: "ai.request",
      intent: "SCREENER_TRANSLATION",
      provider: result.provider,
      model: result.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      latencyMs: Date.now() - startedAt,
      filters: result.data.definition.filters.length,
      status: "ok",
    })

    return { ...result.data, provider: result.provider, model: result.model }
  } catch (error) {
    const code = isAIError(error) ? error.code : "AI_UNAVAILABLE"
    await recordUsage(input.supabase, {
      userId: input.userId,
      provider: provider.name,
      model: provider.model,
      intent: "SCREENER_TRANSLATION",
      symbols: [],
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorCode: code,
    })
    throw error
  }
}
