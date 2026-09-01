import "server-only"

import { AIError } from "./errors"
import { withStructuredOutput } from "./structured"
import type { AIProvider, AIRequest, AIResult } from "./types"

/**
 * The OpenAI-compatible adapter — one POST to `/chat/completions`.
 *
 * Deliberately written over `fetch` rather than a second SDK: this shape is spoken by OpenAI,
 * Groq, Together, OpenRouter, Ollama and llama.cpp, so `AI_BASE_URL` is what makes a local model
 * work at all. A whole SDK for one request body that four vendors already agree on would be a
 * dependency bought for nothing.
 */

const CHAT_PATH = "/chat/completions"

type ChatCompletion = {
  choices?: { message?: { content?: string | null } }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  model?: string
  error?: { message?: string }
}

export function createOpenAIProvider(config: {
  apiKey: string
  baseUrl: string
  model: string
  maxTokens: number
  temperature: number
  timeoutMs: number
}): AIProvider {
  const endpoint = `${config.baseUrl.replace(/\/+$/, "")}${CHAT_PATH}`

  async function generate(request: AIRequest): Promise<AIResult> {
    const startedAt = Date.now()
    let response: Response
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // A local model usually needs no key; sending an empty bearer would be rejected by some.
          ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          messages: [
            { role: "system", content: request.system },
            ...request.messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
        // An AI call must never outlive the function that is holding a user's request open.
        signal: AbortSignal.timeout(config.timeoutMs),
        cache: "no-store",
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") throw AIError.timeout(error)
      throw AIError.unavailable(error)
    }

    if (response.status === 401 || response.status === 403) throw AIError.notConfigured()
    if (response.status === 429) throw AIError.rateLimited(await response.text().catch(() => ""))
    if (!response.ok) throw AIError.unavailable(await response.text().catch(() => response.status))

    const payload = (await response.json().catch(() => null)) as ChatCompletion | null
    const text = payload?.choices?.[0]?.message?.content?.trim()
    if (!payload || !text) throw AIError.invalidResponse(payload?.error?.message ?? "Empty reply.")

    return {
      text,
      usage: {
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0,
      },
      model: payload.model ?? config.model,
      provider: "openai",
      latencyMs: Date.now() - startedAt,
    }
  }

  return withStructuredOutput({ name: "openai", model: config.model, generate })
}
