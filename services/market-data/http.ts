import { logger } from "@/lib/log"
import { MarketDataError } from "./errors"

const DEFAULT_TIMEOUT_MS = 8_000

/**
 * How many times a single call may be attempted, including the first.
 *
 * Two, not five. A Vercel function has a wall clock and a user waiting behind it, and the failures
 * worth retrying — a dropped connection, one unlucky 502 — are overwhelmingly fixed by one more
 * try. Anything that fails twice is an outage, and the page already knows how to degrade: it falls
 * back to cost basis and says the prices are stale.
 */
const MAX_ATTEMPTS = 2

/** Backoff before the second attempt. Small enough to stay inside the request's own budget. */
const RETRY_DELAY_MS = 250

export type FetchJsonOptions = {
  /** Seconds the Next.js Data Cache may serve this response. 0 disables caching. */
  revalidate: number
  /** Cache tags, so a manual refresh can invalidate just this symbol. */
  tags?: string[]
  timeoutMs?: number
  /** Query params. Undefined values are dropped; the API key is added by the caller. */
  searchParams: Record<string, string | number | undefined>
}

/**
 * Which failures are worth trying again.
 *
 * The distinction that matters: **retry a condition that might be different in 250ms, never one
 * that is a statement about the request itself.** A 401 with a bad key will be a 401 forever, and
 * retrying it doubles the load on a provider that is already refusing us. A 404 for a symbol that
 * does not exist is an answer, not a failure.
 *
 * A rate limit is deliberately included. The provider's free tier is per-minute and a second
 * request from a different serverless instance can succeed where ours was unlucky — but only once,
 * which is what `MAX_ATTEMPTS` guarantees. An unbounded retry on a 429 is how a rate limit becomes
 * a self-inflicted outage.
 */
function isRetryable(error: unknown): boolean {
  return error instanceof MarketDataError && error.retryable
}

/**
 * One place where the market-data layer talks to the network.
 *
 * Responsibilities: a hard timeout (a Vercel function must not hang on a slow upstream), one
 * bounded retry for the failures that deserve it, mapping transport failures onto MarketDataError,
 * caching through the Next Data Cache — which is shared across serverless instances, so a cold
 * start still gets a warm price — and logging latency and status without ever logging the key.
 */
export async function fetchJson<T>(
  baseUrl: string,
  path: string,
  apiKey: string,
  options: FetchJsonOptions,
): Promise<T> {
  const url = new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`)
  for (const [key, value] of Object.entries(options.searchParams)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value))
  }
  url.searchParams.set("apikey", apiKey)

  const startedAt = Date.now()
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await attemptFetch<T>(url, options)
      logger.info("market-data.fetch", {
        path,
        status: 200,
        attempt,
        latencyMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      lastError = error
      const retryable = isRetryable(error) && attempt < MAX_ATTEMPTS
      logger.warn("market-data.fetch", {
        path,
        code: error instanceof MarketDataError ? error.code : "UNKNOWN",
        attempt,
        willRetry: retryable,
        latencyMs: Date.now() - startedAt,
      })
      if (!retryable) throw error
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }

  // Unreachable: the loop either returns or throws. Present so the function has no implicit
  // undefined path if MAX_ATTEMPTS is ever set to zero by mistake.
  throw lastError instanceof Error ? lastError : MarketDataError.unavailable(lastError)
}

async function attemptFetch<T>(url: URL, options: FetchJsonOptions): Promise<T> {
  const loggableUrl = new URL(url)
  loggableUrl.searchParams.delete("apikey")

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      next: options.revalidate > 0 ? { revalidate: options.revalidate, tags: options.tags } : undefined,
      cache: options.revalidate > 0 ? undefined : "no-store",
    })

    if (response.status === 429) throw MarketDataError.rateLimited(`HTTP 429 ${loggableUrl}`)
    if (!response.ok) {
      // The status the caller sees is unchanged; what changes is whether we ask again. A 4xx other
      // than 429 is a statement about the request — a rejected key, an endpoint that is not there —
      // and will say the same thing in 250ms.
      const retryable = response.status >= 500
      throw MarketDataError.unavailable(`HTTP ${response.status} ${loggableUrl}`, { retryable })
    }

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof MarketDataError) throw error
    if (error instanceof Error && error.name === "AbortError") {
      throw MarketDataError.timeout(String(loggableUrl))
    }
    throw MarketDataError.unavailable(error)
  } finally {
    clearTimeout(timeout)
  }
}

/** Exported for the reliability tests, which assert exactly which failures are tried again. */
export const RETRY_POLICY = { maxAttempts: MAX_ATTEMPTS, delayMs: RETRY_DELAY_MS, isRetryable }
