import type { Currency, MarketId } from "./market"
import type { FxFreshness } from "./fx"

export type TransactionSide = "buy" | "sell"

/** The minimal shape the calculation engine needs. Storage adds ids, timestamps, notes. */
export type DomainTransaction = {
  symbol: string
  /**
   * Which venue this was traded on, and therefore which currency `price` and `fee` are in.
   * Optional so the pre-phase-9 call sites still compile; absent means US, exactly as the database
   * column defaults.
   */
  market?: MarketId
  side: TransactionSide
  tradeDate: string // ISO date, used for ordering
  quantity: number
  price: number
  fee: number
  /** Tie-breaker for transactions on the same trade date. */
  sequence?: number
}

/**
 * Per-symbol result of replaying every transaction. Includes fully closed positions.
 *
 * **Every money figure here is in the instrument's own currency**, the one it was actually traded
 * in. Translation into the portfolio's base currency happens later, in `priceHoldings`, and is
 * always a separate, separately-nullable field — never an overwrite.
 */
export type Position = {
  symbol: string
  market: MarketId
  /** The currency `investedValue`, `averageCost` and `realizedPnl` are denominated in. */
  currency: Currency
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
  market: MarketId
  /** The currency `proceeds`, `costBasis` and `realizedPnl` are in — the instrument's, not the portfolio's. */
  currency: Currency
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

/**
 * What it took to express this holding in the portfolio's base currency.
 *
 * Present and `identity` when the holding is already in that currency — the overwhelmingly common
 * case, and the reason a single-currency portfolio behaves exactly as it did before phase 9.
 */
export type HoldingFx = {
  rate: number
  /** Null for the identity conversion; no provider was consulted. */
  asOf: string | null
  freshness: FxFreshness
  identity: boolean
}

/**
 * A position priced with a current quote.
 *
 * Read the field names carefully — the split is the whole point:
 *
 * - `currentPrice`, `marketValue`, `unrealizedPnl`, `todayPnl` are in the **instrument's** currency.
 *   NVDA is quoted in dollars whether or not the portfolio is kept in baht.
 * - `baseMarketValue` and its siblings are those same figures translated into the **portfolio's**
 *   base currency at today's rate, and are `null` when no rate is available.
 * - `returnPct` and `todayReturnPct` are ratios of two figures in the same currency, so they are
 *   currency-neutral and never null for FX reasons.
 */
export type Holding = Position & {
  currentPrice: number
  marketValue: number
  unrealizedPnl: number
  /** Percent, e.g. 5.88 */
  returnPct: number
  /**
   * Percent of the portfolio's total market value, e.g. 42.1. Computed in base currency so a baht
   * holding and a dollar holding are compared on the same scale.
   *
   * Null when this holding could not be translated: its share of the portfolio is genuinely
   * unknown then, and 0 would be a lie about a position that exists.
   */
  weight: number | null
  /** Change since yesterday's close. null when the provider gave no previous close. */
  todayPnl: number | null
  todayReturnPct: number | null
  /** True when no quote was available and cost was used as the price. */
  stale: boolean

  // ---- translation into the portfolio's base currency
  baseCurrency: Currency
  /** Null when there is no usable rate between this holding's currency and the base currency. */
  fx: HoldingFx | null
  baseMarketValue: number | null
  baseInvestedValue: number | null
  baseUnrealizedPnl: number | null
  baseTodayPnl: number | null
  baseRealizedPnl: number | null
}

/** How much of a portfolio sits in one currency, before and after translation. */
export type CurrencyExposure = {
  currency: Currency
  /** Market value in that currency, summed natively. */
  nativeValue: number
  /** The same value in the portfolio's base currency, or null when it could not be translated. */
  baseValue: number | null
  /** Percent of the portfolio's translatable market value. Null when nothing could be translated. */
  weight: number | null
  holdings: number
  fx: HoldingFx | null
}

/**
 * **Every money figure in this summary is in `currency`** — the portfolio's base currency — and is
 * summed only over the holdings that could be translated into it. `untranslatedCount` says how many
 * were left out, so a page can tell the user the total is incomplete instead of quietly under-
 * reporting it.
 */
export type PortfolioSummary = {
  /** The portfolio's base currency. Every amount below is denominated in it. */
  currency: Currency
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
  /** Holdings left out of every total above because no FX rate reached the base currency. */
  untranslatedCount: number
  /** Holdings translated at a rate older than the freshness threshold. */
  fxStaleCount: number
  /** One row per currency held, so a mixed portfolio can show what it is exposed to. */
  exposures: CurrencyExposure[]
  /**
   * The effect of currency movement on this portfolio's return.
   *
   * Always `null`, deliberately. Separating it from stock performance needs the FX rate on every
   * past trade date, and Stockly stores none — so the number would be a guess dressed as an
   * analytic. See `docs/MULTI-MARKET.md` for what would have to exist first.
   */
  fxEffect: null
}
