import type {
  Candle,
  CompanyProfile,
  InstrumentSummary,
  Market,
  MarketDataProvider,
  Quote,
  Range,
} from "./types"

/** Fixed prices so Phase 1 exercises the real calculation engine with predictable numbers. */
const PRICES: Record<string, { name: string; price: number; changePct: number; sector: string }> = {
  NVDA: { name: "NVIDIA Corporation", price: 180, changePct: 1.42, sector: "Technology" },
  AAPL: { name: "Apple Inc.", price: 210, changePct: 0.63, sector: "Technology" },
  SOFI: { name: "SoFi Technologies, Inc.", price: 14, changePct: -2.1, sector: "Financials" },
  MSFT: { name: "Microsoft Corporation", price: 430, changePct: 0.28, sector: "Technology" },
  TSLA: { name: "Tesla, Inc.", price: 250, changePct: -1.15, sector: "Consumer Discretionary" },
  AMD: { name: "Advanced Micro Devices, Inc.", price: 165, changePct: 2.04, sector: "Technology" },
  GOOGL: { name: "Alphabet Inc.", price: 195, changePct: 0.41, sector: "Communication Services" },
  AMZN: { name: "Amazon.com, Inc.", price: 225, changePct: -0.32, sector: "Consumer Discretionary" },
}

function quoteFor(symbol: string, market: Market): Quote | null {
  const entry = PRICES[symbol.toUpperCase()]
  if (!entry) return null
  const change = (entry.price * entry.changePct) / 100
  return {
    symbol: symbol.toUpperCase(),
    market,
    price: entry.price,
    change,
    changePct: entry.changePct,
    asOf: new Date().toISOString(),
  }
}

export const mockMarketDataProvider: MarketDataProvider = {
  name: "mock",

  async getQuote(symbol, market = "US") {
    return quoteFor(symbol, market)
  },

  async getQuotes(symbols, market = "US") {
    const out = new Map<string, Quote>()
    for (const symbol of symbols) {
      const quote = quoteFor(symbol, market)
      if (quote) out.set(quote.symbol, quote)
    }
    return out
  },

  async getHistoricalPrices(symbol, range: Range, market = "US"): Promise<Candle[]> {
    const quote = quoteFor(symbol, market)
    if (!quote) return []
    const days = { "1M": 30, "3M": 90, "6M": 180, "1Y": 365, "5Y": 1825 }[range]
    // A deterministic wave, not random, so re-renders do not make the chart jump.
    return Array.from({ length: Math.min(days, 180) }, (_, i) => {
      const t = i / 12
      const close = quote.price * (1 + Math.sin(t) * 0.06 - 0.03)
      return { date: `day-${i}`, open: close, high: close * 1.01, low: close * 0.99, close }
    })
  },

  async searchSymbol(query): Promise<InstrumentSummary[]> {
    const q = query.trim().toUpperCase()
    if (!q) return []
    return Object.entries(PRICES)
      .filter(([symbol, v]) => symbol.includes(q) || v.name.toUpperCase().includes(q))
      .map(([symbol, v]) => ({ symbol, market: "US" as Market, name: v.name }))
  },

  async getCompanyProfile(symbol, market = "US"): Promise<CompanyProfile | null> {
    const entry = PRICES[symbol.toUpperCase()]
    if (!entry) return null
    return {
      symbol: symbol.toUpperCase(),
      market,
      name: entry.name,
      sector: entry.sector,
      currency: "USD",
    }
  },
}

/** Company names for symbols the mock knows, so the UI can label holdings in Phase 1. */
export function mockCompanyName(symbol: string): string | undefined {
  return PRICES[symbol.toUpperCase()]?.name
}
