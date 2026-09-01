export type Market = "US" | "SET"

export type Quote = {
  symbol: string
  market: Market
  price: number
  change: number
  changePct: number
  asOf: string
}

export type Candle = { date: string; open: number; high: number; low: number; close: number }

export type InstrumentSummary = { symbol: string; market: Market; name: string }

export type CompanyProfile = InstrumentSummary & { sector: string | null; currency: string }

export type Range = "1M" | "3M" | "6M" | "1Y" | "5Y"

/**
 * The only surface the app knows. No provider name (Finnhub, Twelve Data, …) may appear outside
 * services/market-data — swapping providers must be a one-line change in index.ts.
 */
export interface MarketDataProvider {
  readonly name: string
  getQuote(symbol: string, market?: Market): Promise<Quote | null>
  getQuotes(symbols: readonly string[], market?: Market): Promise<Map<string, Quote>>
  getHistoricalPrices(symbol: string, range: Range, market?: Market): Promise<Candle[]>
  searchSymbol(query: string): Promise<InstrumentSummary[]>
  getCompanyProfile(symbol: string, market?: Market): Promise<CompanyProfile | null>
}
