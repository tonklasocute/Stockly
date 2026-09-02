import { describe, expect, it } from "vitest"
import {
  CURRENCIES,
  MARKETS,
  MARKET_REGISTRY,
  baseCurrencyOf,
  currencyOf,
  defaultExchangeOf,
  groupByMarket,
  instrumentOf,
  isCurrency,
  isMarket,
  isValidSymbol,
  marketOfExchange,
  marketsUsing,
  normalizeSymbol,
  parseMarket,
  parseSymbolKey,
  symbolKey,
  toCurrency,
  toMarket,
} from "./market"

describe("currency", () => {
  it("accepts the codes a portfolio can be denominated in", () => {
    expect(isCurrency("USD")).toBe(true)
    expect(isCurrency("THB")).toBe(true)
  })

  it("rejects anything else, including a plausible-looking code", () => {
    expect(isCurrency("XYZ")).toBe(false)
    expect(isCurrency("usd")).toBe(false)
    expect(isCurrency(null)).toBe(false)
    expect(isCurrency(42)).toBe(false)
  })

  it("parses untrusted input to null rather than a fallback", () => {
    expect(toCurrency(" thb ")).toBe("THB")
    // Null, not USD: a caller must decide what an unknown currency means in its own context.
    expect(toCurrency("BTC")).toBeNull()
    expect(toCurrency("")).toBeNull()
    expect(toCurrency(undefined)).toBeNull()
  })

  it("falls back to USD only where a column predates the enum", () => {
    expect(baseCurrencyOf("THB")).toBe("THB")
    expect(baseCurrencyOf("XYZ")).toBe("USD")
    expect(baseCurrencyOf(null)).toBe("USD")
  })

  it("rejects a SQL fragment in a currency field", () => {
    expect(toCurrency("USD'; drop table portfolios; --")).toBeNull()
    expect(isCurrency("USD OR 1=1")).toBe(false)
  })
})

describe("market registry", () => {
  it("gives every market a currency, a timezone and at least one session", () => {
    for (const market of MARKETS) {
      const definition = MARKET_REGISTRY[market]
      expect(CURRENCIES).toContain(definition.currency)
      expect(definition.timeZone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/)
      expect(definition.sessions.length).toBeGreaterThan(0)
      expect(definition.exchanges.length).toBeGreaterThan(0)
    }
  })

  it("maps a market to its native currency", () => {
    expect(currencyOf("US")).toBe("USD")
    expect(currencyOf("SET")).toBe("THB")
  })

  it("knows which markets quote in a currency", () => {
    expect(marketsUsing("THB")).toEqual(["SET"])
    expect(marketsUsing("EUR")).toEqual([])
  })

  it("resolves an exchange code back to its market", () => {
    expect(marketOfExchange("NASDAQ")).toBe("US")
    expect(marketOfExchange("nyse")).toBe("US")
    expect(marketOfExchange("SET")).toBe("SET")
    expect(marketOfExchange("XETRA")).toBeNull()
    expect(marketOfExchange(null)).toBeNull()
  })

  it("names a default exchange for a bare symbol", () => {
    expect(defaultExchangeOf("SET")).toBe("SET")
  })
})

describe("market parsing", () => {
  it("accepts a known market in any case", () => {
    expect(toMarket("set")).toBe("SET")
    expect(isMarket("US")).toBe(true)
  })

  it("falls back to US for a display path, and refuses for a request body", () => {
    // A page must still render; a write must not silently store the wrong venue.
    expect(toMarket("mars")).toBe("US")
    expect(parseMarket("mars")).toBeNull()
    expect(parseMarket("SET")).toBe("SET")
  })

  it("rejects an injection attempt in a market field", () => {
    expect(parseMarket("US'; drop table transactions; --")).toBeNull()
  })
})

describe("symbols", () => {
  it("validates per market when one is given", () => {
    expect(isValidSymbol("PTT", "SET")).toBe(true)
    // SET share classes carry a suffix US tickers never do.
    expect(isValidSymbol("PTT-R", "SET")).toBe(true)
    expect(isValidSymbol("SCB-F", "SET")).toBe(true)
    // A dot is a US convention (BRK.B) and is not a SET spelling.
    expect(isValidSymbol("BRK.B", "US")).toBe(true)
    expect(isValidSymbol("BRK.B", "SET")).toBe(false)
  })

  it("stays permissive when the market is not yet known", () => {
    expect(isValidSymbol("BRK.B")).toBe(true)
    expect(isValidSymbol("PTT-R")).toBe(true)
  })

  it("round-trips a symbol key", () => {
    expect(parseSymbolKey(symbolKey("ptt", "SET"))).toEqual({ market: "SET", symbol: "PTT" })
  })

  it("keeps the same ticker on two venues apart", () => {
    expect(symbolKey("CPALL", "SET")).not.toBe(symbolKey("CPALL", "US"))
  })

  it("normalises before keying, so spelling never forks a key", () => {
    expect(symbolKey(" ptt ", "SET")).toBe(symbolKey("PTT", "SET"))
    expect(normalizeSymbol("<script>ptt</script>")).toBe("SCRIPTPTTSCRIPT")
  })
})

describe("instruments", () => {
  it("derives currency and exchange from the market", () => {
    expect(instrumentOf("ptt", "SET")).toEqual({
      symbol: "PTT",
      market: "SET",
      currency: "THB",
      name: null,
      exchange: "SET",
      assetType: "STOCK",
    })
  })

  it("defaults to a US stock, which is what every pre-phase-9 row is", () => {
    expect(instrumentOf("NVDA")).toMatchObject({ market: "US", currency: "USD" })
  })

  it("groups mixed markets so a provider is called once per venue, not once per row", () => {
    const grouped = groupByMarket([
      { market: "US" as const, symbol: "NVDA" },
      { market: "SET" as const, symbol: "PTT" },
      { market: "US" as const, symbol: "AAPL" },
    ])
    expect(grouped.get("US")).toHaveLength(2)
    expect(grouped.get("SET")).toHaveLength(1)
  })
})
