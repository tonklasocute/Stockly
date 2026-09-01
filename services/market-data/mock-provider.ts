import { normalizeSymbol } from "@/lib/symbol"
import type {
  Candle,
  CompanyProfile,
  InstrumentSummary,
  Market,
  MarketDataProvider,
  MarketStatus,
  Quote,
  Range,
} from "./types"

/**
 * Deterministic prices so the app is fully usable without an API key — for local development, and
 * for anyone who has not signed up for a provider yet. Selected with MARKET_DATA_PROVIDER=mock.
 */
const CATALOG: Record<
  string,
  { name: string; price: number; previousClose: number; sector: string; industry: string; exchange: string }
> = {
  NVDA: { name: "NVIDIA Corporation", price: 180, previousClose: 177.48, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ" },
  AAPL: { name: "Apple Inc.", price: 210, previousClose: 208.68, sector: "Technology", industry: "Consumer Electronics", exchange: "NASDAQ" },
  SOFI: { name: "SoFi Technologies, Inc.", price: 14, previousClose: 14.3, sector: "Financials", industry: "Credit Services", exchange: "NASDAQ" },
  MSFT: { name: "Microsoft Corporation", price: 430, previousClose: 428.8, sector: "Technology", industry: "Software", exchange: "NASDAQ" },
  TSLA: { name: "Tesla, Inc.", price: 250, previousClose: 252.91, sector: "Consumer Discretionary", industry: "Auto Manufacturers", exchange: "NASDAQ" },
  AMD: { name: "Advanced Micro Devices, Inc.", price: 165, previousClose: 161.7, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ" },
  GOOGL: { name: "Alphabet Inc.", price: 195, previousClose: 194.2, sector: "Communication Services", industry: "Internet Content", exchange: "NASDAQ" },
  AMZN: { name: "Amazon.com, Inc.", price: 225, previousClose: 225.72, sector: "Consumer Discretionary", industry: "Internet Retail", exchange: "NASDAQ" },
  PLTR: { name: "Palantir Technologies Inc.", price: 155.8, previousClose: 151.11, sector: "Technology", industry: "Software", exchange: "NASDAQ" },
}

function quoteFor(symbol: string, market: Market): Quote | null {
  const key = normalizeSymbol(symbol)
  const entry = CATALOG[key]
  if (!entry) return null

  const change = entry.price - entry.previousClose
  return {
    symbol: key,
    market,
    name: entry.name,
    price: entry.price,
    previousClose: entry.previousClose,
    change,
    changePct: (change / entry.previousClose) * 100,
    dayHigh: entry.price * 1.012,
    dayLow: entry.price * 0.987,
    dayOpen: entry.previousClose,
    volume: 42_000_000,
    averageVolume: 38_000_000,
    fiftyTwoWeekHigh: entry.price * 1.35,
    fiftyTwoWeekLow: entry.price * 0.62,
    currency: "USD",
    exchange: entry.exchange,
    status: "closed",
    asOf: new Date().toISOString(),
  }
}

const POINTS: Record<Range, number> = {
  "1D": 78,
  "1W": 65,
  "1M": 22,
  "3M": 65,
  "6M": 130,
  "1Y": 252,
  "5Y": 260,
  MAX: 400,
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

  async getHistoricalPrices(symbol, range, market = "US"): Promise<Candle[]> {
    const quote = quoteFor(symbol, market)
    if (!quote) return []

    const count = POINTS[range]
    const dayMs = 86_400_000
    const stepMs = range === "1D" ? 5 * 60_000 : range === "1W" ? 30 * 60_000 : dayMs
    const end = Date.now()

    // A deterministic wave rather than random noise, so re-renders do not make the chart jump.
    return Array.from({ length: count }, (_, i) => {
      const t = i / 9
      const close = quote.price * (1 + Math.sin(t) * 0.07 - 0.04)
      const at = new Date(end - (count - 1 - i) * stepMs)
      return {
        date: stepMs < dayMs ? at.toISOString() : at.toISOString().slice(0, 10),
        open: close * 0.998,
        high: close * 1.006,
        low: close * 0.994,
        close,
        volume: 20_000_000,
      }
    })
  },

  async searchSymbols(query): Promise<InstrumentSummary[]> {
    const q = query.trim().toUpperCase()
    if (!q) return []
    return Object.entries(CATALOG)
      .filter(([symbol, v]) => symbol.includes(q) || v.name.toUpperCase().includes(q))
      .slice(0, 8)
      .map(([symbol, v]) => ({
        symbol,
        market: "US" as Market,
        name: v.name,
        exchange: v.exchange,
        currency: "USD",
      }))
  },

  async getCompanyProfile(symbol, market = "US"): Promise<CompanyProfile | null> {
    const key = normalizeSymbol(symbol)
    const entry = CATALOG[key]
    if (!entry) return null
    return {
      symbol: key,
      market,
      name: entry.name,
      exchange: entry.exchange,
      currency: "USD",
      sector: entry.sector,
      industry: entry.industry,
      country: "United States",
      website: `https://example.com/${key.toLowerCase()}`,
      description: `${entry.name} is sample data from the mock market-data provider. Set MARKET_DATA_PROVIDER and MARKET_DATA_API_KEY to use live prices.`,
      marketCap: 1_200_000_000_000,
      employees: 25_000,
    }
  },

  async getMarketStatus(): Promise<MarketStatus> {
    return "closed"
  },
}
