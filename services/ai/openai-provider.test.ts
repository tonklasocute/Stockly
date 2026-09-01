import { afterEach, describe, expect, it, vi } from "vitest"
import { createOpenAIProvider } from "./openai-provider"

/**
 * The provider failure matrix: success, a bad key, a rate limit, a timeout, an outage and an
 * unreadable reply. Each has to come out as a distinct code, because the orchestrator retries some
 * of them and must never retry the others.
 */

const config = {
  apiKey: "test-key",
  baseUrl: "https://example.test/v1",
  model: "test-model",
  maxTokens: 100,
  temperature: 0.2,
  timeoutMs: 5000,
}

const provider = createOpenAIProvider(config)
const request = { system: "system", messages: [{ role: "user" as const, content: "hi" }] }

function mockFetch(implementation: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  vi.stubGlobal("fetch", vi.fn(implementation))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

describe("openai-compatible provider", () => {
  it("returns text and token usage on success", async () => {
    mockFetch(async () =>
      jsonResponse({
        choices: [{ message: { content: "  an answer  " } }],
        usage: { prompt_tokens: 42, completion_tokens: 7 },
        model: "test-model-0001",
      }),
    )

    const result = await provider.generate(request)
    expect(result.text).toBe("an answer")
    expect(result.usage).toEqual({ inputTokens: 42, outputTokens: 7 })
    expect(result.model).toBe("test-model-0001")
    expect(result.provider).toBe("openai")
  })

  it("sends the system prompt separately from the user turn", async () => {
    const calls: RequestInit[] = []
    mockFetch(async (_input, init) => {
      calls.push(init ?? {})
      return jsonResponse({ choices: [{ message: { content: "ok" } }] })
    })

    await provider.generate(request)
    const body = JSON.parse(String(calls[0].body)) as { messages: { role: string }[] }
    expect(body.messages[0].role).toBe("system")
    expect(body.messages[1].role).toBe("user")
  })

  it("maps 401 to a configuration error, which is never retried", async () => {
    mockFetch(async () => jsonResponse({}, 401))
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: "AI_NOT_CONFIGURED",
      retryable: false,
    })
  })

  it("maps 429 to a retryable rate limit", async () => {
    mockFetch(async () => jsonResponse({}, 429))
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: "AI_RATE_LIMITED",
      retryable: true,
    })
  })

  it("maps a 500 to a retryable outage", async () => {
    mockFetch(async () => jsonResponse({}, 500))
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: "AI_UNAVAILABLE",
      retryable: true,
    })
  })

  it("maps an abort to a timeout", async () => {
    mockFetch(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError")
    })
    await expect(provider.generate(request)).rejects.toMatchObject({ code: "AI_TIMEOUT" })
  })

  it("rejects an empty or unreadable reply instead of returning it", async () => {
    mockFetch(async () => jsonResponse({ choices: [] }))
    await expect(provider.generate(request)).rejects.toMatchObject({
      code: "AI_INVALID_RESPONSE",
    })
  })

  it("never leaks the API key into the error surfaced to a caller", async () => {
    mockFetch(async () => new Response("upstream said: key test-key is invalid", { status: 500 }))
    await expect(provider.generate(request)).rejects.toSatisfy(
      (error: unknown) => !String((error as Error).message).includes("test-key"),
    )
  })
})
