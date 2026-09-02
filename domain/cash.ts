import { add, subtract, sumBy } from "./money"
import type { Currency } from "./market"
import type { DomainTransaction } from "./types"

export type CashFlowKind = "deposit" | "withdrawal"

export type DomainCashTransaction = {
  kind: CashFlowKind
  amount: number
  /**
   * The currency this movement is in. Unlike a trade's, it is stored rather than derived from a
   * market: one portfolio can genuinely hold a dollar balance and a baht balance at the same time.
   */
  currency: Currency
  occurredOn: string
}

/** Only the fields the balance needs; the full row carries dates, tax and notes. */
export type DomainDividendCashFlow = {
  netAmount: number
  paidOn: string
}

export type CashSummary = {
  balance: number
  deposits: number
  withdrawals: number
  /** Cash spent on buys, fees included. */
  buyCosts: number
  /** Cash received from sells, fees deducted. */
  sellProceeds: number
  dividends: number
  /**
   * Deposits minus withdrawals: the money the user actually put in. This — not the portfolio's
   * market value — is the denominator for "how has my capital performed".
   */
  netContributed: number
}

/**
 * Cash balance.
 *
 *   deposits − withdrawals − buy costs + sell proceeds + net dividends
 *
 * Fees are already inside the buy cost (they increase it) and the sell proceeds (they reduce it),
 * which is exactly how the cash actually leaves and arrives at a broker, so they are never
 * subtracted a second time here.
 *
 * The balance can legitimately go negative: a user who records trades without recording the deposit
 * that funded them is showing an incomplete history, not a broken calculation. Presenting that
 * honestly is better than clamping it to zero and hiding the missing rows.
 */
export function computeCash(
  transactions: readonly DomainTransaction[],
  cashTransactions: readonly DomainCashTransaction[],
  dividends: readonly DomainDividendCashFlow[] = [],
): CashSummary {
  const deposits = sumBy(
    cashTransactions.filter((c) => c.kind === "deposit"),
    (c) => c.amount,
  )
  const withdrawals = sumBy(
    cashTransactions.filter((c) => c.kind === "withdrawal"),
    (c) => c.amount,
  )
  const buyCosts = sumBy(
    transactions.filter((t) => t.side === "buy"),
    (t) => t.quantity * t.price + t.fee,
  )
  const sellProceeds = sumBy(
    transactions.filter((t) => t.side === "sell"),
    (t) => t.quantity * t.price - t.fee,
  )
  const dividendIncome = sumBy(dividends, (d) => d.netAmount)

  return {
    balance: add(subtract(subtract(deposits, withdrawals), buyCosts), add(sellProceeds, dividendIncome)),
    deposits,
    withdrawals,
    buyCosts,
    sellProceeds,
    dividends: dividendIncome,
    netContributed: subtract(deposits, withdrawals),
  }
}
