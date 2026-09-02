import { currencyOf, marketOf, normalizeSymbol, symbolKey, MARKETS } from "@/domain/market"
import { marketSessionStatus } from "@/domain/calendar"
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
 *
 * SET names are here for the same reason the US ones are: without them a multi-currency portfolio
 * cannot be built, demonstrated or tested without a paid Thai data feed. Prices are plausible round
 * numbers, not real quotes, and the catalog is keyed by market so `CPALL` in Bangkok and a US
 * ticker of the same spelling never collide.
 */
type CatalogEntry = {
  name: string
  price: number
  previousClose: number
  sector: string
  industry: string
  exchange: string
  country: string
}

const CATALOG: Record<string, CatalogEntry> = {
  // ---- US (USD)
  "US:NVDA": { name: "NVIDIA Corporation", price: 180, previousClose: 177.48, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ", country: "United States" },
  "US:AAPL": { name: "Apple Inc.", price: 210, previousClose: 208.68, sector: "Technology", industry: "Consumer Electronics", exchange: "NASDAQ", country: "United States" },
  "US:SOFI": { name: "SoFi Technologies, Inc.", price: 14, previousClose: 14.3, sector: "Financials", industry: "Credit Services", exchange: "NASDAQ", country: "United States" },
  "US:MSFT": { name: "Microsoft Corporation", price: 430, previousClose: 428.8, sector: "Technology", industry: "Software", exchange: "NASDAQ", country: "United States" },
  "US:TSLA": { name: "Tesla, Inc.", price: 250, previousClose: 252.91, sector: "Consumer Discretionary", industry: "Auto Manufacturers", exchange: "NASDAQ", country: "United States" },
  "US:AMD": { name: "Advanced Micro Devices, Inc.", price: 165, previousClose: 161.7, sector: "Technology", industry: "Semiconductors", exchange: "NASDAQ", country: "United States" },
  "US:GOOGL": { name: "Alphabet Inc.", price: 195, previousClose: 194.2, sector: "Communication Services", industry: "Internet Content", exchange: "NASDAQ", country: "United States" },
  "US:AMZN": { name: "Amazon.com, Inc.", price: 225, previousClose: 225.72, sector: "Consumer Discretionary", industry: "Internet Retail", exchange: "NASDAQ", country: "United States" },
  "US:PLTR": { name: "Palantir Technologies Inc.", price: 155.8, previousClose: 151.11, sector: "Technology", industry: "Software", exchange: "NASDAQ", country: "United States" },

  // ---- SET (THB)
  "SET:PTT": { name: "PTT Public Company Limited", price: 32, previousClose: 31.75, sector: "Resources", industry: "Energy & Utilities", exchange: "SET", country: "Thailand" },
  "SET:CPALL": { name: "CP ALL Public Company Limited", price: 54.5, previousClose: 55.25, sector: "Services", industry: "Commerce", exchange: "SET", country: "Thailand" },
  "SET:ADVANC": { name: "Advanced Info Service PCL", price: 288, previousClose: 285, sector: "Technology", industry: "Information & Communication Technology", exchange: "SET", country: "Thailand" },
  "SET:AOT": { name: "Airports of Thailand PCL", price: 42.25, previousClose: 42.75, sector: "Services", industry: "Transportation & Logistics", exchange: "SET", country: "Thailand" },
  "SET:KBANK": { name: "Kasikornbank PCL", price: 158.5, previousClose: 156, sector: "Financials", industry: "Banking", exchange: "SET", country: "Thailand" },
  "SET:DELTA": { name: "Delta Electronics (Thailand) PCL", price: 118, previousClose: 121.5, sector: "Technology", industry: "Electronic Components", exchange: "SET", country: "Thailand" },
  "SET:SCB": { name: "SCB X Public Company Limited", price: 121, previousClose: 120, sector: "Financials", industry: "Banking", exchange: "SET", country: "Thailand" },
  "SET:BDMS": { name: "Bangkok Dusit Medical Services PCL", price: 25.5, previousClose: 25.25, sector: "Services", industry: "Health Care Services", exchange: "SET", country: "Thailand" },
}

function entryFor(symbol: string, market: Market): CatalogEntry | undefined {
  return CATALOG[symbolKey(symbol, market)]
}

function quoteFor(symbol: string, market: Market): Quote | null {
  const key = normalizeSymbol(symbol)
  const entry = entryFor(key, market)
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
    // Never invented: the currency of a market is the one thing about it that is not a guess.
    currency: currencyOf(market),
    exchange: entry.exchange,
    // Derived from the market's own calendar rather than hardcoded, so the mock exercises the same
    // timezone logic a live provider's answer would be checked against.
    status: marketSessionStatus(market, new Date()),
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
  markets: MARKETS,

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

  async searchSymbols(query, market): Promise<InstrumentSummary[]> {
    const q = query.trim().toUpperCase()
    if (!q) return []
    return Object.entries(CATALOG)
      .map(([key, entry]) => {
        const [marketId, symbol] = key.split(":") as [Market, string]
        return { marketId, symbol, entry }
      })
      .filter(({ marketId }) => !market || marketId === market)
      .filter(({ symbol, entry }) => symbol.includes(q) || entry.name.toUpperCase().includes(q))
      .slice(0, 8)
      .map(({ marketId, symbol, entry }) => ({
        symbol,
        market: marketId,
        name: entry.name,
        exchange: entry.exchange,
        currency: currencyOf(marketId),
        assetType: "STOCK" as const,
      }))
  },

  async getCompanyProfile(symbol, market = "US"): Promise<CompanyProfile | null> {
    const key = normalizeSymbol(symbol)
    const entry = entryFor(key, market)
    if (!entry) return null
    return {
      symbol: key,
      market,
      name: entry.name,
      exchange: entry.exchange,
      currency: currencyOf(market),
      assetType: "STOCK",
      sector: entry.sector,
      industry: entry.industry,
      country: entry.country,
      website: `https://example.com/${key.toLowerCase()}`,
      description: `${entry.name} is sample data from the mock market-data provider on ${marketOf(market).label}. Set MARKET_DATA_PROVIDER and MARKET_DATA_API_KEY to use live prices.`,
      marketCap: 1_200_000_000_000,
      employees: 25_000,
    }
  },

  async getMarketStatus(market = "US"): Promise<MarketStatus> {
    return marketSessionStatus(market, new Date())
  },
}
