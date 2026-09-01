import type { Market } from "@/lib/symbol"

export type { Market }

export type MarketStatus = "open" | "closed" | "pre" | "post" | "unknown"

export type Quote = {
  symbol: string
  market: Market
  /** Company name when the provider includes it in the quote, saving a profile call per holding. */
  name: string | null
  price: number
  previousClose: number | null
  change: number | null
  changePct: number | null
  dayHigh: number | null
  dayLow: number | null
  dayOpen: number | null
  volume: number | null
  averageVolume: number | null
  fiftyTwoWeekHigh: number | null
  fiftyTwoWeekLow: number | null
  currency: string | null
  exchange: string | null
  status: MarketStatus
  /** When the provider says this price was taken, ISO 8601. */
  asOf: string
}

export type Candle = {
  /** ISO date, or ISO datetime for intraday ranges. */
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export type Range = "1D" | "1W" | "1M" | "3M" | "6M" | "1Y" | "5Y" | "MAX"

export const RANGES: readonly Range[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y", "MAX"]

export type InstrumentSummary = {
  symbol: string
  market: Market
  name: string
  exchange: string | null
  currency: string | null
}

export type CompanyProfile = InstrumentSummary & {
  sector: string | null
  industry: string | null
  country: string | null
  website: string | null
  description: string | null
  marketCap: number | null
  employees: number | null
}

/**
 * The only market-data surface the application knows. No provider name may appear outside
 * services/market-data — swapping providers must be a one-line change in index.ts.
 *
 * Every method either resolves or throws a MarketDataError; nothing leaks a provider payload.
 */
export interface MarketDataProvider {
  readonly name: string
  /** Null when the provider has no such symbol, rather than a thrown error. */
  getQuote(symbol: string, market?: Market): Promise<Quote | null>
  /** Batched where the provider supports it. Missing symbols are simply absent from the map. */
  getQuotes(symbols: readonly string[], market?: Market): Promise<Map<string, Quote>>
  getHistoricalPrices(symbol: string, range: Range, market?: Market): Promise<Candle[]>
  searchSymbols(query: string): Promise<InstrumentSummary[]>
  getCompanyProfile(symbol: string, market?: Market): Promise<CompanyProfile | null>
  getMarketStatus(market?: Market): Promise<MarketStatus>
}
