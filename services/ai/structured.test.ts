import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { AIError } from "./errors"
import { extractJson, withRetry, withStructuredOutput } from "./structured"
import type { AIRequest, AIResult } from "./types"

const schema = z.object({ summary: z.string(), score: z.number() })

function stubProvider(replies: string[]) {
  const calls: AIRequest[] = []
  let index = 0
  const generate = async (request: AIRequest): Promise<AIResult> => {
    calls.push(request)
    const text = replies[Math.min(index, replies.length - 1)]
    index += 1
    return {
      text,
      usage: { inputTokens: 10, outputTokens: 5 },
      model: "stub",
      provider: "stub",
      latencyMs: 1,
    }
  }
  return { provider: withStructuredOutput({ name: "stub", model: "stub", generate }), calls }
}

const request = {
  system: "system",
  messages: [{ role: "user" as const, content: "hello" }],
  schemaName: "test",
  schemaHint: "{}",
}

describe("extractJson", () => {
  it("parses a bare object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 })
  })

  it("recovers an object from a code fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 })
  })

  it("recovers an object a model wrapped in a sentence", () => {
    expect(extractJson('Here you go: {"a":1} — hope that helps')).toEqual({ a: 1 })
  })

  it("throws when there is no object at all", () => {
    expect(() => extractJson("no json here")).toThrow()
  })
})

describe("withStructuredOutput", () => {
  it("returns validated data on the first attempt", async () => {
    const { provider, calls } = stubProvider(['{"summary":"ok","score":7}'])
    const result = await provider.generateStructured(request, schema)

    expect(result.data).toEqual({ summary: "ok", score: 7 })
    expect(calls).toHaveLength(1)
    // The JSON instruction is appended to the system prompt, never to the user's turn.
    expect(calls[0].system).toContain("single JSON object")
    expect(calls[0].messages).toHaveLength(1)
  })

  it("repairs invalid JSON with one extra round", async () => {
    const { provider, calls } = stubProvider(["not json at all", '{"summary":"ok","score":7}'])
    const result = await provider.generateStructured(request, schema)

    expect(result.data.summary).toBe("ok")
    expect(calls).toHaveLength(2)
    // The repair round shows the model its own reply and what was wrong with it.
    expect(calls[1].messages.at(-1)?.content).toContain("not valid JSON")
    expect(calls[1].messages.at(-2)?.role).toBe("assistant")
    // Tokens from both rounds are billed to the caller, not silently dropped.
    expect(result.usage.inputTokens).toBe(20)
  })

  it("repairs a reply that parses but does not match the schema", async () => {
    const { provider } = stubProvider(['{"summary":"ok"}', '{"summary":"ok","score":1}'])
    await expect(provider.generateStructured(request, schema)).resolves.toMatchObject({
      data: { score: 1 },
    })
  })

  it("rejects rather than returning an unvalidated object after two failures", async () => {
    const { provider, calls } = stubProvider(["nope", "still nope"])
    await expect(provider.generateStructured(request, schema)).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
    })
    // Bounded: it does not keep paying for repairs.
    expect(calls).toHaveLength(2)
  })
})

describe("withRetry", () => {
  it("retries a retryable failure and succeeds", async () => {
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(AIError.rateLimited())
      .mockResolvedValue("done")

    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).resolves.toBe("done")
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it("does not retry a failure that will never succeed", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(AIError.notConfigured())

    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it("gives up after the attempt limit rather than looping", async () => {
    const fn = vi.fn<() => Promise<string>>().mockRejectedValue(AIError.timeout())

    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).rejects.toMatchObject({
      code: "AI_TIMEOUT",
    })
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
