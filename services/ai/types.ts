import type { ZodType } from "zod"

/**
 * The only AI surface the application knows.
 *
 * No provider name may appear outside services/ai — swapping Anthropic for an OpenAI-compatible
 * endpoint, or for a local model, must be one case in index.ts and nothing else. This mirrors the
 * MarketDataProvider boundary exactly, for the same reason: the business rules must not learn the
 * shape of somebody else's JSON.
 */

/**
 * A conversation turn.
 *
 * **There is no `system` role here on purpose.** Operator instructions travel in `AIRequest.system`,
 * which the orchestrator builds and the user can never write into. Keeping the two apart in the
 * type system is the first half of the prompt-injection defence — see docs/AI-SECURITY.md.
 */
export type AIMessage = { role: "user" | "assistant"; content: string }

export type AIRequest = {
  /** Trusted instructions plus retrieved Stockly data. Never contains raw user text verbatim. */
  system: string
  /** The conversation. Everything here is untrusted input. */
  messages: AIMessage[]
  maxTokens?: number
}

export type AIUsage = {
  inputTokens: number
  outputTokens: number
}

export type AIResult = {
  text: string
  usage: AIUsage
  model: string
  provider: string
  /** Wall-clock time for the provider call, for the latency column in ai_usage. */
  latencyMs: number
}

export type AIStructuredResult<T> = AIResult & { data: T }

/**
 * A structured request names its schema, so a provider (and the mock) can tell one task from
 * another, and so the shape hint that goes into the prompt lives beside the schema it describes.
 */
export type AIStructuredRequest = AIRequest & {
  schemaName: string
  /** A one-line description of the JSON shape, embedded in the instructions. */
  schemaHint: string
}

export interface AIProvider {
  readonly name: string
  readonly model: string
  generate(request: AIRequest): Promise<AIResult>
  /**
   * Free text in, validated object out. Invalid JSON is repaired once and rejected after that —
   * an unparseable structure never reaches a caller, let alone the browser.
   */
  generateStructured<T>(
    request: AIStructuredRequest,
    schema: ZodType<T>,
  ): Promise<AIStructuredResult<T>>
}
