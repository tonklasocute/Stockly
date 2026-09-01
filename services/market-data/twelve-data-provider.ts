import { z } from "zod"
import { normalizeSymbol, type Market } from "@/lib/symbol"
import { MarketDataError } from "./errors"
import { fetchJson } from "./http"
import type {
  Candle,
  CompanyProfile,
  InstrumentSummary,
  MarketDataProvider,
  MarketStatus,
  Quote,
  Range,
} from "./types"

/**
 * Twelve Data adapter.
 *
 * Why this provider: the free tier is the only one of the mainstream options that still serves
 * historical time series, which the price chart needs. Finnhub has a more generous rate limit but
 * moved stock candles behind a paid plan; Alpha Vantage's free tier is 25 requests a day.
 *
 * Free-tier limits that shape the design (see docs/ARCHITECTURE.md):
 *   - 8 API credits per minute, 800 per day.
 *   - A batch quote costs one credit PER SYMBOL, not per request, so batching saves latency and
 *     round trips but not quota. Caching is what protects the quota.
 *   - /profile is not on every plan; a 4xx there degrades to search metadata rather than failing.
 */

const BATCH_SIZE = 20

/** Twelve Data reports application-level failures with HTTP 200 and a `status: "error"` body. */
const errorEnvelope = z.object({
  status: z.literal("error"),
  code: z.number().optional(),
  message: z.string().optional(),
})

const numeric = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null
    const parsed = typeof value === "number" ? value : Number(value)
    return Number.isFinite(parsed) ? parsed : null
  })

const rawQuote = z.object({
  symbol: z.string(),
  name: z.string().nullish(),
  exchange: z.string().nullish(),
  currency: z.string().nullish(),
  datetime: z.string().nullish(),
  timestamp: z.number().nullish(),
  open: numeric,
  high: numeric,
  low: numeric,
  close: numeric,
  previous_close: numeric,
  change: numeric,
  percent_change: numeric,
  volume: numeric,
  average_volume: numeric,
  is_market_open: z.boolean().nullish(),
  fifty_two_week: z
    .object({ high: numeric, low: numeric })
    .nullish(),
})

const rawCandle = z.object({
  datetime: z.string(),
  open: numeric,
  high: numeric,
  low: numeric,
  close: numeric,
  volume: numeric,
})

const rawTimeSeries = z.object({
  values: z.array(rawCandle).nullish(),
})

const rawSearchResult = z.object({
  symbol: z.string(),
  instrument_name: z.string().nullish(),
  exchange: z.string().nullish(),
  currency: z.string().nullish(),
  country: z.string().nullish(),
  instrument_type: z.string().nullish(),
})

const rawSearch = z.object({ data: z.array(rawSearchResult).nullish() })

const rawProfile = z.object({
  symbol: z.string().nullish(),
  name: z.string().nullish(),
  exchange: z.string().nullish(),
  sector: z.string().nullish(),
  industry: z.string().nullish(),
  country: z.string().nullish(),
  website: z.string().nullish(),
  description: z.string().nullish(),
  market_capitalization: numeric,
  employees: numeric,
  currency: z.string().nullish(),
})

const rawMarketState = z.array(
  z.object({
    name: z.string().nullish(),
    code: z.string().nullish(),
    is_market_open: z.boolean().nullish(),
    time_after_open: z.string().nullish(),
  }),
)

/** Rejects the error envelope first, then parses; a schema miss is never silently swallowed. */
function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const asError = errorEnvelope.safeParse(payload)
  if (asError.success) {
    // 429 is reported in the body, not the status line, on this provider.
    if (asError.data.code === 429) throw MarketDataError.rateLimited(asError.data.message)
    throw MarketDataError.unavailable(`provider error ${asError.data.code}: ${asError.data.message}`)
  }
  const parsed = schema.safeParse(payload)
  if (!parsed.success) throw MarketDataError.invalidResponse(parsed.error.message)
  return parsed.data
}

/** Range -> the interval and point count that make a readable chart without wasting credits. */
const RANGE_QUERY: Record<Range, { interval: string; outputsize: number }> = {
  "1D": { interval: "5min", outputsize: 78 },
  "1W": { interval: "30min", outputsize: 65 },
  "1M": { interval: "1day", outputsize: 22 },
  "3M": { interval: "1day", outputsize: 65 },
  "6M": { interval: "1day", outputsize: 130 },
  "1Y": { interval: "1day", outputsize: 252 },
  "5Y": { interval: "1week", outputsize: 260 },
  MAX: { interval: "1month", outputsize: 400 },
}

function toQuote(raw: z.infer<typeof rawQuote>, market: Market): Quote | null {
  const price = raw.close
  // A row with no price is not a quote; treating it as 0 would poison every portfolio total.
  if (price === null) return null

  return {
    symbol: normalizeSymbol(raw.symbol),
    market,
    name: raw.name ?? null,
    price,
    previousClose: raw.previous_close,
    change: raw.change,
    changePct: raw.percent_change,
    dayHigh: raw.high,
    dayLow: raw.low,
    dayOpen: raw.open,
    volume: raw.volume,
    averageVolume: raw.average_volume,
    fiftyTwoWeekHigh: raw.fifty_two_week?.high ?? null,
    fiftyTwoWeekLow: raw.fifty_two_week?.low ?? null,
    currency: raw.currency ?? null,
    exchange: raw.exchange ?? null,
    status: raw.is_market_open === undefined || raw.is_market_open === null
      ? "unknown"
      : raw.is_market_open
        ? "open"
        : "closed",
    asOf: raw.timestamp
      ? new Date(raw.timestamp * 1000).toISOString()
      : (raw.datetime ?? new Date().toISOString()),
  }
}

export function createTwelveDataProvider(config: {
  apiKey: string
  baseUrl: string
}): MarketDataProvider {
  const call = <T>(
    path: string,
    searchParams: Record<string, string | number | undefined>,
    revalidate: number,
    tags?: string[],
  ) => fetchJson<T>(config.baseUrl, path, config.apiKey, { searchParams, revalidate, tags })

  return {
    name: "twelvedata",

    async getQuote(symbol, market = "US") {
      const quotes = await this.getQuotes([symbol], market)
      return quotes.get(normalizeSymbol(symbol)) ?? null
    },

    async getQuotes(symbols, market = "US") {
      const wanted = [...new Set(symbols.map(normalizeSymbol).filter(Boolean))]
      const out = new Map<string, Quote>()
      if (wanted.length === 0) return out

      // Batched purely to cut round trips — the provider still bills one credit per symbol.
      for (let i = 0; i < wanted.length; i += BATCH_SIZE) {
        const batch = wanted.slice(i, i + BATCH_SIZE)
        const payload = await call<unknown>(
          "quote",
          { symbol: batch.join(","), dp: 4 },
          QUOTE_TTL_SECONDS,
          batch.map((s) => `quote:${s}`),
        )

        // A top-level error envelope must not be silently parsed away as "no quotes": a rate limit
        // would then look like a portfolio of unpriced holdings instead of a reported failure.
        const asError = errorEnvelope.safeParse(payload)
        if (asError.success) {
          if (asError.data.code === 429) throw MarketDataError.rateLimited(asError.data.message)
          // 400/404 means the provider does not know these symbols — that is no data, not an outage.
          if (asError.data.code === 400 || asError.data.code === 404) continue
          throw MarketDataError.unavailable(
            `provider error ${asError.data.code}: ${asError.data.message}`,
          )
        }

        // One symbol returns the object directly; several return a map keyed by symbol.
        const rows =
          batch.length === 1
            ? [payload]
            : Object.values((payload ?? {}) as Record<string, unknown>)

        for (const row of rows) {
          // A single bad symbol in a batch must not discard the good ones.
          const parsed = rawQuote.safeParse(row)
          if (!parsed.success) continue
          const quote = toQuote(parsed.data, market)
          if (quote) out.set(quote.symbol, quote)
        }
      }
      return out
    },

    async getHistoricalPrices(symbol, range) {
      const normalized = normalizeSymbol(symbol)
      if (!normalized) return []
      const { interval, outputsize } = RANGE_QUERY[range]

      const payload = await call<unknown>(
        "time_series",
        { symbol: normalized, interval, outputsize, order: "ASC", dp: 4 },
        historyTtlSeconds(range),
        [`history:${normalized}:${range}`],
      )

      // An unknown symbol comes back as the error envelope; that is "no data", not an outage.
      const asError = errorEnvelope.safeParse(payload)
      if (asError.success && asError.data.code !== 429) return []

      const series = parse(rawTimeSeries, payload)
      return (series.values ?? [])
        .filter((c): c is typeof c & { close: number } => c.close !== null)
        .map(
          (c): Candle => ({
            date: c.datetime,
            open: c.open ?? c.close,
            high: c.high ?? c.close,
            low: c.low ?? c.close,
            close: c.close,
            volume: c.volume,
          }),
        )
    },

    async searchSymbols(query) {
      const trimmed = query.trim()
      if (trimmed.length === 0) return []

      const payload = await call<unknown>(
        "symbol_search",
        { symbol: trimmed, outputsize: 12 },
        SEARCH_TTL_SECONDS,
      )
      const parsed = parse(rawSearch, payload)

      return (parsed.data ?? [])
        // Phase 2 is US equities only; showing venues we cannot price would be a dead end.
        .filter((row) => (row.country ?? "United States") === "United States")
        .filter((row) => !row.instrument_type || /stock|common|etf/i.test(row.instrument_type))
        .slice(0, 8)
        .map(
          (row): InstrumentSummary => ({
            symbol: normalizeSymbol(row.symbol),
            market: "US",
            name: row.instrument_name ?? row.symbol,
            exchange: row.exchange ?? null,
            currency: row.currency ?? null,
          }),
        )
    },

    async getCompanyProfile(symbol, market = "US") {
      const normalized = normalizeSymbol(symbol)
      if (!normalized) return null

      let payload: unknown
      try {
        payload = await call<unknown>("profile", { symbol: normalized }, PROFILE_TTL_SECONDS, [
          `profile:${normalized}`,
        ])
      } catch (error) {
        // /profile is not on every plan. Falling back to search metadata beats an error page.
        if (error instanceof MarketDataError && error.code === "MARKET_DATA_RATE_LIMITED") throw error
        return fallbackProfile(this, normalized, market)
      }

      const asError = errorEnvelope.safeParse(payload)
      if (asError.success) {
        if (asError.data.code === 429) throw MarketDataError.rateLimited(asError.data.message)
        return fallbackProfile(this, normalized, market)
      }

      const raw = parse(rawProfile, payload)
      return {
        symbol: normalized,
        market,
        name: raw.name ?? normalized,
        exchange: raw.exchange ?? null,
        currency: raw.currency ?? null,
        sector: raw.sector ?? null,
        industry: raw.industry ?? null,
        country: raw.country ?? null,
        website: raw.website ?? null,
        description: raw.description ?? null,
        marketCap: raw.market_capitalization,
        employees: raw.employees,
      }
    },

    async getMarketStatus(): Promise<MarketStatus> {
      try {
        const payload = await call<unknown>(
          "market_state",
          { exchange: "NASDAQ" },
          MARKET_STATE_TTL_SECONDS,
        )
        const asError = errorEnvelope.safeParse(payload)
        if (asError.success) return "unknown"

        const parsed = rawMarketState.safeParse(payload)
        const open = parsed.success ? parsed.data[0]?.is_market_open : undefined
        return open === undefined || open === null ? "unknown" : open ? "open" : "closed"
      } catch {
        // Market status is decoration; never fail a page over it, and never guess from client time.
        return "unknown"
      }
    },
  }
}

async function fallbackProfile(
  provider: MarketDataProvider,
  symbol: string,
  market: Market,
): Promise<CompanyProfile | null> {
  const [match] = await provider.searchSymbols(symbol)
  if (!match || match.symbol !== symbol) return null
  return {
    ...match,
    market,
    sector: null,
    industry: null,
    country: null,
    website: null,
    description: null,
    marketCap: null,
    employees: null,
  }
}

/**
 * Cache lifetimes. Quotes are the only thing that moves within a session; history and profiles are
 * near-static, so they are held long enough that a chart never costs a second credit in a day.
 */
export const QUOTE_TTL_SECONDS = 60
export const SEARCH_TTL_SECONDS = 60 * 60 * 24
export const PROFILE_TTL_SECONDS = 60 * 60 * 24
export const MARKET_STATE_TTL_SECONDS = 60

export function historyTtlSeconds(range: Range): number {
  // Intraday ranges move during the session; daily and longer ones only change after the close.
  return range === "1D" || range === "1W" ? 60 * 5 : 60 * 60 * 6
}
