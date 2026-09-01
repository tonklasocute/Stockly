import { z } from "zod"
import { AI_INTENTS } from "@/domain/ai"
import { screenerDefinitionSchema } from "@/features/screener/schema"

/**
 * Every boundary the AI feature has: what a client may send in, and what the model may hand back.
 *
 * The second one is the unusual part. A language model's output is untrusted input arriving from
 * the other direction, so it is parsed by Zod exactly like a request body — and if it does not
 * validate, it is repaired once and then rejected. Nothing unvalidated reaches the browser.
 */

// ---------------------------------------------------------------- limits
//
// Cost protection, stated once. Every one of these is a hard bound on what a single request can
// make the server (and the provider bill) do.

export const MAX_QUESTION_LENGTH = 1000
/** How many earlier turns travel with a question. The rest of the conversation is not sent. */
export const MAX_HISTORY_MESSAGES = 6
/**
 * A character ceiling on the assembled context, checked before the call. Characters rather than
 * tokens because it costs nothing to measure and no tokeniser can disagree with it; roughly four
 * characters to a token, so this is about 6k tokens of retrieved data.
 */
export const MAX_CONTEXT_CHARS = 24_000

// ---------------------------------------------------------------- what the model returns

/**
 * The narrative — **the only thing the model authors.**
 *
 * There is no `price`, no `rsi`, no `score` field here, and that is the whole grounding design:
 * every figure the user sees is assembled server-side from Stockly's engines and merged with this
 * text. A model cannot get a number wrong if it is never asked for one.
 */
export const narrativeSchema = z.object({
  summary: z.string().trim().min(1).max(1200),
  interpretation: z.string().trim().max(1500).default(""),
  positives: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
  risks: z.array(z.string().trim().min(1).max(300)).max(6).default([]),
  /** Caveats, data gaps, anything the model could not answer. Null when there are none. */
  notes: z.string().trim().max(600).nullable().default(null),
})

export type Narrative = z.output<typeof narrativeSchema>

/** The shape hint that goes into the prompt. Kept beside the schema so the two cannot drift. */
export const NARRATIVE_HINT = `{
  "summary": "2-4 sentences describing what the data shows",
  "interpretation": "what those conditions mean, hedged, no forecast",
  "positives": ["short factual observations, at most 6"],
  "risks": ["short factual observations, at most 6"],
  "notes": "caveats or missing data, or null"
}`

/**
 * A screen proposed from a sentence.
 *
 * It reuses `screenerDefinitionSchema` unchanged, so a filter the model invents is validated by
 * exactly the same closed enums as one a user builds by hand. The model cannot widen the metric
 * list by asking nicely.
 */
export const proposedScreenSchema = z.object({
  definition: screenerDefinitionSchema,
  explanation: z.string().trim().min(1).max(600),
})

export type ProposedScreen = z.output<typeof proposedScreenSchema>

export const PROPOSED_SCREEN_HINT = `{
  "definition": {
    "logic": "AND" | "OR",
    "filters": [{ "metric": "<one of the allowed metrics>", "operator": "GT|GTE|LT|LTE|EQ|CROSS_ABOVE|CROSS_BELOW", "value": <number, or a trend name for TREND> }],
    "sort": { "metric": "<allowed metric>", "direction": "asc" | "desc" }
  },
  "explanation": "one or two sentences on why these conditions match the request"
}`

// ---------------------------------------------------------------- what a client may send

export const aiChatSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "Ask a question.")
    .max(MAX_QUESTION_LENGTH, `Keep your question under ${MAX_QUESTION_LENGTH} characters.`),
  /** Continues an existing conversation. Ownership is checked against the session, never trusted. */
  conversationId: z.uuid().optional(),
  /** Scopes portfolio questions. Verified against the caller's own portfolios before use. */
  portfolioId: z.uuid().optional(),
})

export const aiAnalyzeSchema = z.object({
  symbol: z.string().trim().min(1).max(20),
  portfolioId: z.uuid().optional(),
})

export const aiCompareSchema = z.object({
  symbols: z.array(z.string().trim().min(1).max(20)).min(2).max(4),
})

export const aiScreenerSchema = z.object({
  query: z
    .string()
    .trim()
    .min(1, "Describe what you are looking for.")
    .max(MAX_QUESTION_LENGTH),
})
