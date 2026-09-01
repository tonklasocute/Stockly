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

/** A position priced with a current quote. */
export type Holding = Position & {
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  /** Percent, e.g. 5.88 */
  returnPct: number
  /** Percent of total market value, e.g. 42.1 */
  weight: number
}

export type PortfolioSummary = {
  marketValue: number
  investedValue: number
  unrealizedPnl: number
  realizedPnl: number
  /** Percent return on the invested value of open positions. */
  returnPct: number
  holdingsCount: number
}
