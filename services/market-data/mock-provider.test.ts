import { describe, expect, it } from "vitest"
import { currencyOf } from "@/domain/market"
import { mockMarketDataProvider } from "./mock-provider"

/**
 * The mock is what makes a multi-market portfolio buildable without a paid Thai data feed, so the
 * properties that matter are the ones a live adapter must also hold: a quote is tagged with the
 * venue it came from, priced in that venue's currency, and never leaks across markets.
 */
describe("mock provider across markets", () => {
  it("declares the markets it can serve", () => {
    expect(mockMarketDataProvider.markets).toContain("US")
    expect(mockMarketDataProvider.markets).toContain("SET")
  })

  it("prices a SET stock in baht and a US stock in dollars", async () => {
    const ptt = await mockMarketDataProvider.getQuote("PTT", "SET")
    expect(ptt).toMatchObject({ symbol: "PTT", market: "SET", currency: "THB" })

    const nvda = await mockMarketDataProvider.getQuote("NVDA", "US")
    expect(nvda).toMatchObject({ symbol: "NVDA", market: "US", currency: "USD" })
  })

  it("never answers a symbol from the wrong market", () => {
    // PTT is not a US listing; a provider that answered anyway would price baht as dollars.
    return expect(mockMarketDataProvider.getQuote("PTT", "US")).resolves.toBeNull()
  })

  it("takes the currency from the market registry, so it can never disagree with the engine", async () => {
    for (const market of ["US", "SET"] as const) {
      const quotes = await mockMarketDataProvider.getQuotes(["PTT", "NVDA"], market)
      for (const quote of quotes.values()) expect(quote.currency).toBe(currencyOf(market))
    }
  })

  it("batches within one market", async () => {
    const quotes = await mockMarketDataProvider.getQuotes(["PTT", "CPALL", "AOT"], "SET")
    expect([...quotes.keys()].sort()).toEqual(["AOT", "CPALL", "PTT"])
  })

  it("returns history only for a symbol that exists on the requested market", async () => {
    expect((await mockMarketDataProvider.getHistoricalPrices("PTT", "1M", "SET")).length).toBe(22)
    expect(await mockMarketDataProvider.getHistoricalPrices("PTT", "1M", "US")).toEqual([])
  })

  it("tags each search result with its own venue and currency", async () => {
    const all = await mockMarketDataProvider.searchSymbols("A")
    for (const result of all) expect(result.currency).toBe(currencyOf(result.market))

    const thaiOnly = await mockMarketDataProvider.searchSymbols("A", "SET")
    expect(thaiOnly.every((r) => r.market === "SET")).toBe(true)
    expect(thaiOnly.length).toBeGreaterThan(0)
  })

  it("reports a per-market session status rather than one global one", async () => {
    const [us, set] = await Promise.all([
      mockMarketDataProvider.getMarketStatus("US"),
      mockMarketDataProvider.getMarketStatus("SET"),
    ])
    for (const status of [us, set]) {
      expect(["open", "closed", "pre", "post", "unknown"]).toContain(status)
    }
  })
})
