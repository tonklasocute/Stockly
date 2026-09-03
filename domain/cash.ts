import { add, subtract, sumBy } from "./money"
import { currencyOf, type Currency, type MarketId } from "./market"
import type { DomainTransaction } from "./types"

/**
 * The cash ledger.
 *
 * Every movement is a positive amount plus a kind, and the kind carries the direction. A signed
 * amount would let the same movement be written two ways — `-100 deposit` and `100 withdrawal` —
 * and a ledger with two spellings for one fact cannot be reconciled against anything.
 *
 * The kinds divide along a line that matters more than it looks:
 *
 *   **capital flows**      deposit, withdrawal, transfer in/out, adjustment in/out
 *                          Money crossing the portfolio's boundary. Never a return, and removed
 *                          from both sides of every performance figure.
 *   **outcomes**           fee, tax, interest
 *                          Money the portfolio earned or was charged. Part of performance, and
 *                          emphatically not contributed capital: a portfolio that shrank by a
 *                          custody fee did worse, it was not withdrawn from.
 *
 * Getting that wrong is how a deposit becomes a profit. `CASH_FLOW_DIRECTION` and
 * `CAPITAL_FLOW_KINDS` below are the single statement of both rules, and every consumer reads them
 * rather than testing for `"deposit"` — which is what let phase 12's three call sites treat every
 * unrecognised kind as a withdrawal.
 */

export const CASH_FLOW_KINDS = [
  "deposit",
  "withdrawal",
  "fee",
  "tax",
  "interest",
  "transfer_in",
  "transfer_out",
  "adjustment_in",
  "adjustment_out",
] as const

export type CashFlowKind = (typeof CASH_FLOW_KINDS)[number]

/**
 * Which way each kind moves the balance. Exhaustive by type: adding a kind without a direction is
 * a compile error rather than a movement that silently counts as an outflow.
 */
export const CASH_FLOW_DIRECTION: Record<CashFlowKind, 1 | -1> = {
  deposit: 1,
  withdrawal: -1,
  fee: -1,
  tax: -1,
  interest: 1,
  transfer_in: 1,
  transfer_out: -1,
  adjustment_in: 1,
  adjustment_out: -1,
}

/**
 * The kinds that move money across the portfolio's boundary.
 *
 * A transfer is external capital in exactly the way a deposit is — the money came from somewhere
 * else — and an adjustment is a correction to the record of capital, not something the portfolio
 * earned. Interest, fees and tax are none of those: they happened *to* the portfolio.
 */
export const CAPITAL_FLOW_KINDS: readonly CashFlowKind[] = [
  "deposit",
  "withdrawal",
  "transfer_in",
  "transfer_out",
  "adjustment_in",
  "adjustment_out",
]

export function isCapitalFlow(kind: CashFlowKind): boolean {
  return CAPITAL_FLOW_KINDS.includes(kind)
}

/** Human labels. Kept beside the kinds so a new one cannot ship without a name. */
export const CASH_FLOW_LABELS: Record<CashFlowKind, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  fee: "Fee",
  tax: "Tax",
  interest: "Interest",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  adjustment_in: "Adjustment (increase)",
  adjustment_out: "Adjustment (decrease)",
}

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

/** The amount with its direction applied, for anything that sums movements. */
export function signedAmount(flow: Pick<DomainCashTransaction, "kind" | "amount">): number {
  return flow.amount * CASH_FLOW_DIRECTION[flow.kind]
}

/** Only the fields the balance needs; the full row carries dates, tax and notes. */
export type DomainDividendCashFlow = {
  netAmount: number
  paidOn: string
  /** Absent on the pre-phase-19 call sites, which had already translated to one currency. */
  currency?: Currency
}

export type CashSummary = {
  balance: number
  /** Capital that came in: deposits, transfers in, upward adjustments. */
  deposits: number
  /** Capital that went out: withdrawals, transfers out, downward adjustments. */
  withdrawals: number
  /** Cash spent on buys, fees included. */
  buyCosts: number
  /** Cash received from sells, fees deducted. */
  sellProceeds: number
  dividends: number
  /** Account-level charges — custody, commission not attached to a trade, and tax. */
  charges: number
  /** Credit interest. Earned by the portfolio, so never contributed capital. */
  interest: number
  /**
   * Capital in minus capital out: the money the user actually put in. This — not the portfolio's
   * market value — is the denominator for "how has my capital performed".
   */
  netContributed: number
}

function sumOfKinds(
  flows: readonly DomainCashTransaction[],
  predicate: (kind: CashFlowKind) => boolean,
): number {
  return sumBy(flows.filter((c) => predicate(c.kind)), (c) => c.amount)
}

/**
 * Cash balance.
 *
 *   capital in − capital out − buy costs + sell proceeds + net dividends + interest − charges
 *
 * Trade fees are already inside the buy cost (they increase it) and the sell proceeds (they reduce
 * it), which is exactly how the cash leaves and arrives at a broker, so they are never subtracted a
 * second time here. A `fee` row is an *account* charge — custody, inactivity, a wire — and is the
 * only kind of fee this line subtracts.
 *
 * The balance can legitimately go negative: a user who records trades without recording the deposit
 * that funded them is showing an incomplete history, not a broken calculation. Presenting that
 * honestly is better than clamping it to zero and hiding the missing rows.
 *
 * **Currency-blind, and only safe because of where it is called.** Every caller translates its
 * movements into one currency first and drops the ones it could not translate. Use
 * `computeCashByCurrency` when the question is what the balance is in each currency separately —
 * that one never converts anything.
 */
export function computeCash(
  transactions: readonly DomainTransaction[],
  cashTransactions: readonly DomainCashTransaction[],
  dividends: readonly DomainDividendCashFlow[] = [],
): CashSummary {
  const deposits = sumOfKinds(cashTransactions, (k) => isCapitalFlow(k) && CASH_FLOW_DIRECTION[k] === 1)
  const withdrawals = sumOfKinds(cashTransactions, (k) => isCapitalFlow(k) && CASH_FLOW_DIRECTION[k] === -1)
  const charges = sumOfKinds(cashTransactions, (k) => k === "fee" || k === "tax")
  const interest = sumOfKinds(cashTransactions, (k) => k === "interest")

  const buyCosts = sumBy(
    transactions.filter((t) => t.side === "buy"),
    (t) => t.quantity * t.price + t.fee,
  )
  const sellProceeds = sumBy(
    transactions.filter((t) => t.side === "sell"),
    (t) => t.quantity * t.price - t.fee,
  )
  const dividendIncome = sumBy(dividends, (d) => d.netAmount)

  const netContributed = subtract(deposits, withdrawals)
  const fromTrading = add(subtract(sellProceeds, buyCosts), add(dividendIncome, interest))

  return {
    balance: subtract(add(netContributed, fromTrading), charges),
    deposits,
    withdrawals,
    buyCosts,
    sellProceeds,
    dividends: dividendIncome,
    charges,
    interest,
    netContributed,
  }
}

/** One currency's balance, computed only from movements actually denominated in it. */
export type CurrencyCashBalance = {
  currency: Currency
  balance: number
  deposits: number
  withdrawals: number
  buyCosts: number
  sellProceeds: number
  dividends: number
  charges: number
  interest: number
  netContributed: number
}

/**
 * The cash balance **per currency**, with no exchange rate anywhere in it.
 *
 * This is the figure a broker statement can actually be reconciled against: a statement reports a
 * dollar balance and a baht balance, never a translated total, and comparing a translated total
 * against either one would report a difference that is really just today's rate.
 *
 * A trade's currency is its market's, derived and never stored; a cash movement's and a dividend's
 * are stored, because a portfolio can hold two balances and a listing can pay in a third currency.
 * Nothing is summed across currencies here — that is the entire point.
 */
export function computeCashByCurrency(
  transactions: readonly DomainTransaction[],
  cashTransactions: readonly DomainCashTransaction[],
  dividends: readonly DomainDividendCashFlow[] = [],
): CurrencyCashBalance[] {
  const currencies = new Set<Currency>()
  for (const tx of transactions) currencies.add(currencyOf(tx.market ?? ("US" as MarketId)))
  for (const flow of cashTransactions) currencies.add(flow.currency)
  for (const dividend of dividends) if (dividend.currency) currencies.add(dividend.currency)

  return [...currencies]
    .sort()
    .map((currency) => {
      const summary = computeCash(
        transactions.filter((t) => currencyOf(t.market ?? ("US" as MarketId)) === currency),
        cashTransactions.filter((c) => c.currency === currency),
        dividends.filter((d) => d.currency === currency),
      )
      return { currency, ...summary }
    })
}
