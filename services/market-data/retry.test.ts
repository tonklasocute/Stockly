import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { fetchJson, RETRY_POLICY } from "./http"
import { MarketDataError } from "./errors"

/**
 * Provider reliability.
 *
 * The property under test is not "does it retry" but **which failures it retries** — retrying the
 * wrong one doubles the load on a provider that is already refusing us, and retrying none of them
 * turns a dropped connection into a page that says prices are unavailable.
 */

const ORIGINAL_FETCH = globalThis.fetch

function respondWith(...responses: Array<Response | Error>) {
  const calls: string[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input))
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]
    if (next instanceof Error) throw next
    return next
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return { calls, fetchMock }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const call = () =>
  fetchJson<{ ok: boolean }>("https://api.example.com", "quote", "SECRET-KEY", {
    revalidate: 0,
    searchParams: { symbol: "NVDA" },
  })

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
  globalThis.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

describe("what is retried", () => {
  it("retries a 5xx and succeeds on the second attempt", async () => {
    const { calls } = respondWith(json({}, 502), json({ ok: true }))
    await expect(call()).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it("retries a timeout", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" })
    const { calls } = respondWith(abort, json({ ok: true }))
    await expect(call()).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it("retries a dropped connection", async () => {
    const { calls } = respondWith(new TypeError("fetch failed"), json({ ok: true }))
    await expect(call()).resolves.toEqual({ ok: true })
    expect(calls).toHaveLength(2)
  })

  it("retries a rate limit exactly once, never more", async () => {
    // An unbounded retry on a 429 is how a rate limit becomes an outage of our own making.
    const { calls } = respondWith(json({}, 429))
    await expect(call()).rejects.toMatchObject({ code: "MARKET_DATA_RATE_LIMITED" })
    expect(calls).toHaveLength(2)
  })
})

describe("what is not retried", () => {
  it("does not retry a rejected key", async () => {
    const { calls } = respondWith(json({ message: "invalid api key" }, 401))
    await expect(call()).rejects.toBeInstanceOf(MarketDataError)
    expect(calls).toHaveLength(1)
  })

  it("does not retry a bad request", async () => {
    const { calls } = respondWith(json({}, 400))
    await expect(call()).rejects.toBeInstanceOf(MarketDataError)
    expect(calls).toHaveLength(1)
  })

  it("does not retry a 404", async () => {
    const { calls } = respondWith(json({}, 404))
    await expect(call()).rejects.toBeInstanceOf(MarketDataError)
    expect(calls).toHaveLength(1)
  })

  it("is bounded, so a persistent outage costs two requests and not a storm", async () => {
    const { calls } = respondWith(json({}, 503))
    await expect(call()).rejects.toBeInstanceOf(MarketDataError)
    expect(calls).toHaveLength(RETRY_POLICY.maxAttempts)
    expect(RETRY_POLICY.maxAttempts).toBeLessThanOrEqual(3)
  })
})

describe("the key never escapes", () => {
  it("is sent to the provider", async () => {
    const { calls } = respondWith(json({ ok: true }))
    await call()
    expect(calls[0]).toContain("apikey=SECRET-KEY")
  })

  it("is absent from the error a failure produces", async () => {
    respondWith(json({}, 500))
    // The message is what gets logged and, in a development build, what a developer reads. A key in
    // it would be a key in the log platform.
    await expect(call()).rejects.toSatisfy(
      (error: MarketDataError) => !String(error.cause ?? "").includes("SECRET-KEY"),
    )
  })
})

describe("the retryable flag", () => {
  it("is set on the failures a second attempt could fix", () => {
    expect(RETRY_POLICY.isRetryable(MarketDataError.timeout())).toBe(true)
    expect(RETRY_POLICY.isRetryable(MarketDataError.rateLimited())).toBe(true)
    expect(RETRY_POLICY.isRetryable(MarketDataError.unavailable())).toBe(true)
  })

  it("is absent from the failures that are statements about the request", () => {
    expect(RETRY_POLICY.isRetryable(MarketDataError.notConfigured())).toBe(false)
    expect(RETRY_POLICY.isRetryable(MarketDataError.invalidResponse())).toBe(false)
    expect(RETRY_POLICY.isRetryable(MarketDataError.unavailable("HTTP 401", { retryable: false }))).toBe(false)
  })

  it("is false for anything that is not a provider error", () => {
    expect(RETRY_POLICY.isRetryable(new Error("something else"))).toBe(false)
    expect(RETRY_POLICY.isRetryable(null)).toBe(false)
  })
})
