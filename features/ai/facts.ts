import type { ScoreComponent } from "@/domain/technical"
import type { HistorySummary } from "@/domain/ai"

/**
 * The grounded payload: every figure Stockly AI shows, and where each one came from.
 *
 * Kept apart from the retrieval code so both the renderer and the client components can depend on
 * the shape without dragging a Supabase client into the browser bundle — and so the shape is
 * testable on its own.
 *
 * **Every numeric field is nullable, and null means "not available".** Nothing here may be zero as
 * a stand-in for a missing reading; a fabricated zero in a financial figure is worse than an
 * admitted gap, and the whole point of this layer is that the model cannot invent one.
 */

export type PositionFacts = {
  quantity: number
  averageCost: number
  marketValue: number
  unrealizedPnl: number
  returnPct: number
  /** Null when the holding could not be expressed in the portfolio's base currency. */
  weightPct: number | null
}

export type StockFacts = {
  symbol: string
  /** The venue these figures came from. Prices and indicators are in that market's currency. */
  market: string
  name: string | null
  currency: string
  price: number | null
  previousClose: number | null
  changePct: number | null
  quoteAsOf: string | null
  /** Indicator readings, all nullable — a missing one is unavailable, never zero. */
  rsi: number | null
  adx: number | null
  macdHistogram: number | null
  relativeVolume: number | null
  atrPct: number | null
  ema50: number | null
  ema200: number | null
  trend: string
  stage: string
  score: number | null
  scoreVersion: string
  components: ScoreComponent[]
  signals: string[]
  candleCount: number
  indicatorsAsOf: string | null
  indicatorsDelayed: boolean
  history: HistorySummary | null
  position: PositionFacts | null
  watched: boolean
}

export type PortfolioFacts = {
  name: string
  currency: string
  totalValue: number
  investedValue: number
  cashValue: number
  unrealizedPnl: number
  realizedPnl: number
  returnPct: number | null
  todayChangePct: number | null
  holdingCount: number
  largest: { symbol: string; weightPct: number | null } | null
  topWeightsPct: number
  sectors: { label: string; weightPct: number }[]
  gainers: { symbol: string; returnPct: number }[]
  losers: { symbol: string; returnPct: number }[]
  technicals: { symbol: string; trend: string; score: number | null }[]
}

export type WatchlistFacts = {
  count: number
  bullish: number
  neutral: number
  bearish: number
  rows: { symbol: string; trend: string; score: number | null; rsi: number | null; relativeVolume: number | null }[]
}

export type MarketFacts = {
  /** Stockly has no index feed on the free tier; breadth is measured over the tracked universe. */
  universeSize: number
  bullish: number
  neutral: number
  bearish: number
  medianScore: number | null
  aboveAverageVolume: number
  asOf: string | null
  delayed: boolean
}

export type ScreenExplanation = {
  screenName: string
  symbol: string
  passedAll: boolean
  results: { condition: string; passed: boolean; actual: string }[]
}

export type GroundedData = {
  stocks: StockFacts[]
  portfolio: PortfolioFacts | null
  watchlist: WatchlistFacts | null
  market: MarketFacts | null
  screen: ScreenExplanation | null
  unknownSymbols: string[]
  /** Set when live prices could not be loaded. The narrative says so rather than inventing them. */
  marketDataError: string | null
}

