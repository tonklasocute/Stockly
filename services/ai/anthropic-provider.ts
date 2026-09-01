import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { AIError } from "./errors"
import { withStructuredOutput } from "./structured"
import type { AIProvider, AIRequest, AIResult } from "./types"

/**
 * The Claude adapter.
 *
 * The official SDK owns the transport: it already implements the timeout, the bounded retry and
 * the typed error classes, and re-implementing those over `fetch` would be three more things to
 * get subtly wrong. Everything Stockly-specific — grounding, validation, safety — lives above
 * this file, so nothing here knows what a portfolio is.
 */

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5"

/**
 * Effort, not temperature.
 *
 * Current Claude models reject `temperature`, `top_p` and `top_k` outright, and thinking is on by
 * default. This workload is grounded summarisation over data Stockly has already computed — not a
 * hard reasoning problem — so low effort is both the faster and the cheaper setting, and it keeps
 * a chat reply inside a serverless function's budget.
 */
const EFFORT = "low" as const

function toAIError(error: unknown): AIError {
  if (error instanceof Anthropic.AuthenticationError) return AIError.notConfigured()
  if (error instanceof Anthropic.RateLimitError) return AIError.rateLimited(error)
  if (error instanceof Anthropic.APIConnectionTimeoutError) return AIError.timeout(error)
  if (error instanceof Anthropic.APIConnectionError) return AIError.unavailable(error)
  if (error instanceof Anthropic.APIError) {
    // A 400 is our bug — a malformed request — and retrying it would just burn the budget.
    return error.status && error.status >= 400 && error.status < 500 && error.status !== 429
      ? new AIError("AI_UNAVAILABLE", "Stockly AI could not process that request.", { cause: error })
      : AIError.unavailable(error)
  }
  return AIError.unavailable(error)
}

export function createAnthropicProvider(config: {
  apiKey: string
  model?: string
  maxTokens: number
  timeoutMs: number
}): AIProvider {
  const model = config.model || DEFAULT_ANTHROPIC_MODEL
  const client = new Anthropic({
    apiKey: config.apiKey,
    timeout: config.timeoutMs,
    // The SDK retries 408/409/429/5xx. Kept low: the orchestrator has its own bounded retry above
    // it, and the two multiply.
    maxRetries: 1,
  })

  async function generate(request: AIRequest): Promise<AIResult> {
    const startedAt = Date.now()
    try {
      const response = await client.messages.create({
        model,
        max_tokens: request.maxTokens ?? config.maxTokens,
        system: request.system,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        output_config: { effort: EFFORT },
      })

      // A safety decline is a 200 with no usable text. Surfacing it as "unavailable" is honest:
      // the user gets a sentence rather than an empty card.
      if (response.stop_reason === "refusal") {
        throw new AIError("AI_UNAVAILABLE", "Stockly AI declined to answer that question.", {
          cause: response.stop_details,
        })
      }

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim()

      if (!text) throw AIError.invalidResponse("Empty reply.")

      return {
        text,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
        model: response.model,
        provider: "anthropic",
        latencyMs: Date.now() - startedAt,
      }
    } catch (error) {
      throw error instanceof AIError ? error : toAIError(error)
    }
  }

  return withStructuredOutput({ name: "anthropic", model, generate })
}
