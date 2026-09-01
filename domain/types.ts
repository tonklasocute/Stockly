export type TransactionSide = "buy" | "sell"

/** The minimal shape the calculation engine needs. Storage adds ids, timestamps, notes. */
export type DomainTransaction = {
  symbol: string
  side: TransactionSide
  tradeDate: string // ISO date, used for ordering
  quantity: number
  price: number
  fee: number
  /** Tie-breaker for transactions on the same trade date. */
  sequence?: number
}

/** Per-symbol result of replaying every transaction. Includes fully closed positions. */
export type Position = {
  symbol: string
  /** Shares currently held. 0 for a closed position. */
  quantity: number
  /** Cost basis of the shares still held, fees included. */
  investedValue: number
  /** investedValue / quantity. 0 when nothing is held. */
  averageCost: number
  /** Booked profit/loss from shares already sold, fees included. */
  realizedPnl: number
}

/**
 * A booked profit or loss: one sell, with the cost basis it consumed. This is the unit that
 * realized-P&L statistics (win rate, best trade, average win) are computed over.
 */
export type RealizedTrade = {
  symbol: string
  soldOn: string
  /** When this run of ownership began. Null if the position was never opened by a buy. */
  openedOn: string | null
  quantity: number
  /** Sale value after the sell fee. */
  proceeds: number
  /** Weighted-average cost released by this sell, buy fees included. */
  costBasis: number
  realizedPnl: number
  /** Null when the cost basis was zero, which is not a zero return. */
  returnPct: number | null
  /** Only set when this sell closed the position, so the holding period is exact. */
  holdingDays: number | null
}

/** What the engine needs from a quote. Providers return far more; this is the whole contract. */
export type PricePoint = {
  price: number
  /** Yesterday's close. Absent when the provider did not return one — today's P&L is then unknown. */
  previousClose?: number
}

/** A position priced with a current quote. */
export type Holding = Position & {
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  /** Percent, e.g. 5.88 */
  returnPct: number
  /** Percent of total market value, e.g. 42.1 */
  weight: number
  /** Change since yesterday's close. null when the provider gave no previous close. */
  todayPnl: number | null
  todayReturnPct: number | null
  /** True when no quote was available and cost was used as the price. */
  stale: boolean
}

export type PortfolioSummary = {
  marketValue: number
  investedValue: number
  unrealizedPnl: number
  realizedPnl: number
  /** Percent return on the invested value of open positions. */
  returnPct: number
  holdingsCount: number
  /** Change since yesterday's close, summed over the holdings that have a previous close. */
  todayPnl: number | null
  todayReturnPct: number | null
  /** Holdings priced from cost because no quote was available. */
  staleCount: number
}
