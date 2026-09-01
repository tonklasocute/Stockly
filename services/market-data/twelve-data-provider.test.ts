import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MarketDataError } from "./errors"
import { createTwelveDataProvider } from "./twelve-data-provider"

const provider = createTwelveDataProvider({ apiKey: "test-key", baseUrl: "https://api.example.com" })

/** Replaces global fetch with a queue of canned responses; no test ever reaches the network. */
function mockFetch(...responses: Array<{ status?: number; body: unknown }>) {
  const calls: URL[] = []
  const queue = [...responses]
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: URL | string) => {
      calls.push(new URL(String(input)))
      const next = queue.shift() ?? responses[responses.length - 1]
      return {
        ok: (next.status ?? 200) < 400,
        status: next.status ?? 200,
        json: async () => next.body,
      } as Response
    }),
  )
  return calls
}

const QUOTE = {
  symbol: "NVDA",
  name: "NVIDIA Corporation",
  exchange: "NASDAQ",
  currency: "USD",
  datetime: "2026-08-31",
  timestamp: 1756684800,
  open: "176.00",
  high: "181.20",
  low: "175.40",
  close: "180.25",
  previous_close: "175.93",
  change: "4.32",
  percent_change: "2.4555",
  volume: "41000000",
  average_volume: "38000000",
  is_market_open: false,
  fifty_two_week: { high: "240.00", low: "86.62" },
}

beforeEach(() => vi.unstubAllGlobals())
afterEach(() => vi.unstubAllGlobals())

describe("quote parsing", () => {
  it("maps the provider payload onto the domain model", async () => {
    mockFetch({ body: QUOTE })
    const quote = await provider.getQuote("nvda")

    expect(quote).toMatchObject({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      price: 180.25,
      previousClose: 175.93,
      change: 4.32,
      dayHigh: 181.2,
      fiftyTwoWeekHigh: 240,
      exchange: "NASDAQ",
      status: "closed",
    })
    expect(quote?.changePct).toBeCloseTo(2.4555, 4)
  })

  it("normalises the requested symbol before calling the provider", async () => {
    const calls = mockFetch({ body: QUOTE })
    await provider.getQuote("  nvda ")
    expect(calls[0].searchParams.get("symbol")).toBe("NVDA")
  })

  it("never puts the api key anywhere but the query string it sends", async () => {
    const calls = mockFetch({ body: QUOTE })
    await provider.getQuote("NVDA")
    expect(calls[0].searchParams.get("apikey")).toBe("test-key")
  })

  it("treats a row with no price as no quote rather than as zero", async () => {
    mockFetch({ body: { ...QUOTE, close: null } })
    expect(await provider.getQuote("NVDA")).toBeNull()
  })

  it("reports missing optional fields as null, never as zero", async () => {
    mockFetch({ body: { symbol: "NVDA", close: "180.25" } })
    const quote = await provider.getQuote("NVDA")
    expect(quote).toMatchObject({
      price: 180.25,
      previousClose: null,
      volume: null,
      fiftyTwoWeekHigh: null,
      status: "unknown",
    })
  })

  it("returns null for a symbol the provider does not know, rather than throwing", async () => {
    mockFetch({ body: { status: "error", code: 400, message: "symbol not found" } })
    expect(await provider.getQuote("NOPE")).toBeNull()
  })

  it("throws on a provider fault reported in the body, so it is not mistaken for no data", async () => {
    mockFetch({ body: { status: "error", code: 500, message: "internal" } })
    await expect(provider.getQuote("NVDA")).rejects.toMatchObject({
      code: "MARKET_DATA_UNAVAILABLE",
    })
  })
})

describe("batch quotes", () => {
  it("asks for every symbol in one request", async () => {
    const calls = mockFetch({
      body: { NVDA: QUOTE, AAPL: { ...QUOTE, symbol: "AAPL", close: "210.00" } },
    })
    const quotes = await provider.getQuotes(["nvda", "AAPL"])

    expect(calls).toHaveLength(1)
    expect(calls[0].searchParams.get("symbol")).toBe("NVDA,AAPL")
    expect([...quotes.keys()].sort()).toEqual(["AAPL", "NVDA"])
  })

  it("keeps the good rows when one symbol in the batch is malformed", async () => {
    mockFetch({ body: { NVDA: QUOTE, JUNK: { status: "error", code: 400 } } })
    const quotes = await provider.getQuotes(["NVDA", "JUNK"])
    expect([...quotes.keys()]).toEqual(["NVDA"])
  })

  it("deduplicates symbols and skips unusable ones", async () => {
    const calls = mockFetch({ body: { NVDA: QUOTE } })
    await provider.getQuotes(["nvda", "NVDA", "  ", "!!!"])
    expect(calls[0].searchParams.get("symbol")).toBe("NVDA")
  })

  it("makes no request at all for an empty symbol list", async () => {
    const calls = mockFetch({ body: {} })
    expect((await provider.getQuotes([])).size).toBe(0)
    expect(calls).toHaveLength(0)
  })
})

describe("failure modes", () => {
  it("maps an HTTP 429 onto a rate-limit error", async () => {
    mockFetch({ status: 429, body: {} })
    await expect(provider.getQuote("NVDA")).rejects.toMatchObject({
      code: "MARKET_DATA_RATE_LIMITED",
    })
  })

  it("maps the provider's in-body 429 onto a rate-limit error too", async () => {
    mockFetch({ body: { status: "error", code: 429, message: "API credits exceeded" } })
    await expect(provider.getQuote("NVDA")).rejects.toMatchObject({
      code: "MARKET_DATA_RATE_LIMITED",
    })
  })

  it("maps a server error onto an unavailable error", async () => {
    mockFetch({ status: 503, body: {} })
    await expect(provider.getQuote("NVDA")).rejects.toMatchObject({
      code: "MARKET_DATA_UNAVAILABLE",
    })
  })

  it("maps a network failure onto an unavailable error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("network down") }))
    await expect(provider.getQuote("NVDA")).rejects.toMatchObject({
      code: "MARKET_DATA_UNAVAILABLE",
    })
  })

  it("never leaks the provider's message to the user-facing text", async () => {
    mockFetch({ status: 503, body: {} })
    const error = await provider
      .getQuote("NVDA")
      .then(() => null)
      .catch((e: unknown) => e as MarketDataError)
    expect(error).toBeInstanceOf(MarketDataError)
    expect(error?.message).not.toContain("api.example.com")
    expect(error?.message).not.toContain("test-key")
  })
})

describe("historical prices", () => {
  const SERIES = {
    values: [
      { datetime: "2026-08-28", open: "170", high: "175", low: "169", close: "174", volume: "1000" },
      { datetime: "2026-08-29", open: "174", high: "181", low: "173", close: "180", volume: "1200" },
    ],
  }

  it("returns candles in the order given", async () => {
    mockFetch({ body: SERIES })
    const candles = await provider.getHistoricalPrices("NVDA", "1M")
    expect(candles).toHaveLength(2)
    expect(candles[1]).toEqual({
      date: "2026-08-29",
      open: 174,
      high: 181,
      low: 173,
      close: 180,
      volume: 1200,
    })
  })

  it("asks for an interval that suits the range", async () => {
    const calls = mockFetch({ body: SERIES })
    await provider.getHistoricalPrices("NVDA", "1D")
    expect(calls[0].searchParams.get("interval")).toBe("5min")

    await provider.getHistoricalPrices("NVDA", "5Y")
    expect(calls[1].searchParams.get("interval")).toBe("1week")
  })

  it("treats an unknown symbol as no data, not as an outage", async () => {
    mockFetch({ body: { status: "error", code: 400, message: "symbol not found" } })
    expect(await provider.getHistoricalPrices("NOPE", "1M")).toEqual([])
  })

  it("still throws when the provider is rate limiting", async () => {
    mockFetch({ body: { status: "error", code: 429, message: "limit" } })
    await expect(provider.getHistoricalPrices("NVDA", "1M")).rejects.toMatchObject({
      code: "MARKET_DATA_RATE_LIMITED",
    })
  })

  it("drops candles with no close rather than charting a zero", async () => {
    mockFetch({ body: { values: [...SERIES.values, { datetime: "2026-08-30", close: null }] } })
    expect(await provider.getHistoricalPrices("NVDA", "1M")).toHaveLength(2)
  })

  it("returns nothing for an empty series", async () => {
    mockFetch({ body: { values: null } })
    expect(await provider.getHistoricalPrices("NVDA", "1M")).toEqual([])
  })
})

describe("symbol search", () => {
  const RESULTS = {
    data: [
      { symbol: "NVDA", instrument_name: "NVIDIA Corporation", exchange: "NASDAQ", currency: "USD", country: "United States", instrument_type: "Common Stock" },
      { symbol: "NVDA", instrument_name: "NVIDIA CDR", exchange: "NEO", currency: "CAD", country: "Canada", instrument_type: "Common Stock" },
    ],
  }

  it("returns US listings only in phase 2", async () => {
    mockFetch({ body: RESULTS })
    const results = await provider.searchSymbols("nvidia")
    expect(results).toEqual([
      { symbol: "NVDA", market: "US", name: "NVIDIA Corporation", exchange: "NASDAQ", currency: "USD" },
    ])
  })

  it("makes no request for a blank query", async () => {
    const calls = mockFetch({ body: RESULTS })
    expect(await provider.searchSymbols("   ")).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it("returns nothing when the provider has no matches", async () => {
    mockFetch({ body: { data: [] } })
    expect(await provider.searchSymbols("zzzz")).toEqual([])
  })
})

describe("company profile", () => {
  it("maps the profile payload", async () => {
    mockFetch({
      body: {
        symbol: "NVDA",
        name: "NVIDIA Corporation",
        exchange: "NASDAQ",
        sector: "Technology",
        industry: "Semiconductors",
        country: "United States",
        website: "https://nvidia.com",
        description: "Designs GPUs.",
        market_capitalization: "4400000000000",
        employees: "36000",
      },
    })
    expect(await provider.getCompanyProfile("nvda")).toMatchObject({
      symbol: "NVDA",
      sector: "Technology",
      marketCap: 4_400_000_000_000,
      employees: 36000,
    })
  })

  it("falls back to search metadata when the plan has no profile endpoint", async () => {
    mockFetch(
      { status: 403, body: {} },
      {
        body: {
          data: [
            { symbol: "NVDA", instrument_name: "NVIDIA Corporation", exchange: "NASDAQ", currency: "USD", country: "United States" },
          ],
        },
      },
    )
    expect(await provider.getCompanyProfile("NVDA")).toMatchObject({
      symbol: "NVDA",
      name: "NVIDIA Corporation",
      sector: null,
      description: null,
    })
  })
})

describe("market status", () => {
  it("reads the provider rather than guessing from the clock", async () => {
    mockFetch({ body: [{ code: "NASDAQ", is_market_open: true }] })
    expect(await provider.getMarketStatus()).toBe("open")
  })

  it("is unknown when the provider cannot say", async () => {
    mockFetch({ status: 500, body: {} })
    expect(await provider.getMarketStatus()).toBe("unknown")
  })
})
