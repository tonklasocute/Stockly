import type { CorporateEvent } from "@/domain/corporate-events"
import type { FinancialStatement, PeriodType } from "@/domain/fundamentals"
import type { MarketId } from "@/domain/market"

/**
 * The fundamental data provider contract.
 *
 * Deliberately the same shape as `MarketDataProvider`: an interface here, an adapter per vendor, a
 * router that picks one per market, and **no vendor name anywhere outside this folder**. Adding a
 * fundamentals vendor is a new adapter plus one case in `create()`.
 *
 * Two things this interface does that the market-data one does not need to:
 *
 * 1. **It declares what it cannot do.** `capabilities` is part of the contract, because fundamental
 *    coverage is wildly uneven — a vendor may have US income statements and no SET balance sheets,
 *    and a UI that asks and gets nothing cannot tell "no data" from "not covered". A provider says
 *    up front which markets and which statements it answers for.
 * 2. **Missing is normal, not an error.** A provider returning `[]` for a small-cap's cash-flow
 *    history is the expected case. Only a timeout, a rate limit or a malformed response throws.
 */

export type FundamentalCapabilities = {
  /** Markets this provider answers for at all. */
  markets: readonly MarketId[]
  /** Period types it supplies. A provider with only annuals cannot answer a quarterly question. */
  periods: readonly PeriodType[]
  statements: boolean
  corporateEvents: boolean
  earningsCalendar: boolean
  dividendHistory: boolean
  /**
   * Forward estimates.
   *
   * **False for every provider Stockly currently has**, which is why `domain/valuation.ts` has no
   * forward-multiple field at all. A provider that sets this true is claiming a defensible
   * consensus estimate, and adding the field would be a deliberate change, not an accident.
   */
  forwardEstimates: boolean
}

export type StatementRequest = {
  symbol: string
  market: MarketId
  periodType: PeriodType
  /** How many periods back. Bounded by the adapter, never unbounded. */
  limit: number
}

export type DividendPayment = {
  /** Ex-dividend date, which is the one that decides who receives it. */
  exDate: string
  paymentDate: string | null
  recordDate: string | null
  amountPerShare: number
  currency: string | null
}

export interface FundamentalDataProvider {
  readonly name: string
  readonly capabilities: FundamentalCapabilities

  /**
   * Financial statements, newest first. `[]` when the provider has none — which is a normal answer
   * and not an error.
   */
  getFinancialStatements(request: StatementRequest): Promise<FinancialStatement[]>

  /** Shares outstanding, for a market capitalisation. Null when unsupplied. */
  getSharesOutstanding(symbol: string, market: MarketId): Promise<number | null>

  getCorporateEvents(symbol: string, market: MarketId): Promise<CorporateEvent[]>

  getDividendHistory(symbol: string, market: MarketId): Promise<DividendPayment[]>
}
