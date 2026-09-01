import { MarketDataError } from "./errors"

const DEFAULT_TIMEOUT_MS = 8_000

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
 * One place where the market-data layer talks to the network.
 *
 * Responsibilities: a hard timeout (a Vercel function must not hang on a slow upstream), mapping
 * transport failures onto MarketDataError, caching through the Next Data Cache — which is shared
 * across serverless instances, so a cold start still gets a warm price — and logging latency and
 * status without ever logging the key.
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
  // Appended last and never logged: url.toString() below is taken before the key is added.
  const loggableUrl = url.toString()
  url.searchParams.set("apikey", apiKey)

  const startedAt = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

  let status = 0
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
      next: options.revalidate > 0 ? { revalidate: options.revalidate, tags: options.tags } : undefined,
      cache: options.revalidate > 0 ? undefined : "no-store",
    })
    status = response.status

    if (response.status === 429) throw MarketDataError.rateLimited(`HTTP 429 ${loggableUrl}`)
    if (!response.ok) throw MarketDataError.unavailable(`HTTP ${response.status} ${loggableUrl}`)

    return (await response.json()) as T
  } catch (error) {
    if (error instanceof MarketDataError) throw error
    if (error instanceof Error && error.name === "AbortError") {
      throw MarketDataError.timeout(loggableUrl)
    }
    throw MarketDataError.unavailable(error)
  } finally {
    clearTimeout(timeout)
    console.info(
      `[market-data] ${path} status=${status || "error"} latency=${Date.now() - startedAt}ms`,
    )
  }
}
