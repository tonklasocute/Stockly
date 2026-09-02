import type { AssetType, Currency, MarketId } from "@/domain/market"

export type { AssetType, Currency, MarketId }

/** Kept as an alias: `Market` is the name the phase 2–8 call sites use. */
export type Market = MarketId

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
  /**
   * What the provider says this instrument is quoted in. Kept as a loose string because a provider
   * may report anything; `currencyOf(market)` is the value the engine trusts, and a disagreement
   * between the two is a data-quality signal rather than something to silently resolve.
   */
  currency: string | null
  assetType?: AssetType
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
  /**
   * The markets this adapter can price. The router refuses to send it anything else rather than
   * letting a US endpoint answer a SET symbol with a plausible-looking wrong price.
   */
  readonly markets: readonly Market[]
  /** Null when the provider has no such symbol, rather than a thrown error. */
  getQuote(symbol: string, market?: Market): Promise<Quote | null>
  /** Batched where the provider supports it. Missing symbols are simply absent from the map. */
  getQuotes(symbols: readonly string[], market?: Market): Promise<Map<string, Quote>>
  getHistoricalPrices(symbol: string, range: Range, market?: Market): Promise<Candle[]>
  /** Scoped to one market when given; otherwise every market the adapter covers. */
  searchSymbols(query: string, market?: Market): Promise<InstrumentSummary[]>
  getCompanyProfile(symbol: string, market?: Market): Promise<CompanyProfile | null>
  getMarketStatus(market?: Market): Promise<MarketStatus>
}
