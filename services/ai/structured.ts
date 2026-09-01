import type { ZodType } from "zod"
import { AIError } from "./errors"
import type { AIProvider, AIRequest, AIResult, AIStructuredRequest, AIStructuredResult } from "./types"

/**
 * Structured output, once, for every provider.
 *
 * Providers differ in how (and whether) they constrain output to a schema, so Stockly does not
 * depend on any of them doing it: the model is asked for JSON, the answer is parsed, and the
 * result is validated with the same Zod schema the rest of the app uses. One repair round follows
 * a failure, and after that the request is rejected — an unvalidated object never reaches a caller.
 *
 * `ponytail:` ceiling — a provider's native constrained decoding (Anthropic's `output_config.format`,
 * OpenAI's `response_format`) would lower the repair rate. It would not remove the validation,
 * which has to exist anyway, so it buys latency and not safety. Add it per-adapter when the repair
 * rate is measured to matter.
 */

const MAX_STRUCTURED_ATTEMPTS = 2

const jsonInstruction = (hint: string) =>
  [
    "",
    "## Output format",
    "Reply with a single JSON object and nothing else. No prose before or after it, no markdown",
    "code fence, no explanation. The object must match this shape:",
    hint,
  ].join("\n")

/**
 * Pulls the JSON object out of a reply. Models occasionally wrap it in a fence or add a sentence
 * despite the instruction; taking the outermost braces recovers those without accepting garbage,
 * because whatever comes out still has to parse and then validate.
 */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = (fenced?.[1] ?? text).trim()
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start === -1 || end <= start) throw new SyntaxError("No JSON object in the reply.")
  return JSON.parse(body.slice(start, end + 1))
}

/**
 * Wraps a `generate`-only adapter into a full provider. Adapters implement one method; the repair
 * loop, the JSON instruction and the validation are shared, so two adapters cannot drift apart in
 * how strictly they validate.
 */
export function withStructuredOutput(base: {
  name: string
  model: string
  generate: (request: AIRequest) => Promise<AIResult>
}): AIProvider {
  return {
    name: base.name,
    model: base.model,
    generate: base.generate,

    async generateStructured<T>(
      request: AIStructuredRequest,
      schema: ZodType<T>,
    ): Promise<AIStructuredResult<T>> {
      const messages = [...request.messages]
      let lastProblem = ""
      let totalInput = 0
      let totalOutput = 0
      let totalLatency = 0

      for (let attempt = 1; attempt <= MAX_STRUCTURED_ATTEMPTS; attempt += 1) {
        const result = await base.generate({
          system: `${request.system}\n${jsonInstruction(request.schemaHint)}`,
          messages,
          maxTokens: request.maxTokens,
        })
        totalInput += result.usage.inputTokens
        totalOutput += result.usage.outputTokens
        totalLatency += result.latencyMs

        try {
          const parsed = schema.parse(extractJson(result.text))
          return {
            ...result,
            usage: { inputTokens: totalInput, outputTokens: totalOutput },
            latencyMs: totalLatency,
            data: parsed,
          }
        } catch (error) {
          lastProblem = error instanceof Error ? error.message : String(error)
          // Repair round: show the model its own reply and what was wrong with it. Not a prefill —
          // current Claude models reject those — just an ordinary next turn.
          messages.push({ role: "assistant", content: result.text.slice(0, 4000) })
          messages.push({
            role: "user",
            content:
              "That was not valid JSON for the required shape. " +
              `The problem was: ${lastProblem.slice(0, 500)}. ` +
              "Reply again with only the JSON object.",
          })
        }
      }

      throw AIError.invalidResponse(
        `${base.name}/${request.schemaName} failed validation twice: ${lastProblem}`,
      )
    },
  }
}

/**
 * Retries a provider call on the failures that are worth retrying — a rate limit, a timeout, a
 * transient outage — and never on the ones that are not, such as a bad key or an unusable reply.
 *
 * Bounded on purpose: an AI request already costs money and holds a serverless function open, so
 * an unbounded retry turns one slow provider into an outage of your own making.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, baseDelayMs = 400 } = {},
): Promise<T> {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      const retryable = error instanceof AIError && error.retryable
      if (!retryable || attempt === attempts) throw error
      // Exponential backoff with jitter, so a burst of users does not retry in lockstep.
      const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random())
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw lastError
}
