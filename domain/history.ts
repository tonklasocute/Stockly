import { replayPortfolio } from "./holdings"
import {
  CASH_FLOW_DIRECTION,
  computeCash,
  isCapitalFlow,
  type DomainCashTransaction,
} from "./cash"
import { add, sumBy } from "./money"
import type { DomainTransaction, Position, RealizedTrade } from "./types"
import type { Currency } from "./market"

/**
 * Reconstructing what a portfolio was, on a given date.
 *
 * **This module owns no arithmetic.** Every figure it returns comes from `replayPortfolio` and
 * `computeCash` — the same functions the dashboard calls — applied to the transactions that had
 * happened by the date in question. There is no historical cost-basis formula, no second P&L rule
 * and no stored past state: reconstruction is a *filter plus the existing engine*, which is the
 * only way a figure about March can be guaranteed to agree with what March's dashboard showed.
 *
 * What is exact and what is not, stated plainly because it decides what the UI may claim:
 *
 * - **Exact, from transactions alone:** quantity, cost basis, invested capital, realised P&L, cash,
 *   capital flows, fees, dividends received. None of these needs a price, so none of them can be
 *   unavailable for a date the portfolio existed.
 * - **Needs a historical price:** market value, unrealised P&L, total return. Stockly does not
 *   store a price history, so these are supplied by the caller from the snapshot series where one
 *   exists — and are `null` where it does not. Never 0.
 *
 * Pure: no client, no network, no framework import.
 */

/** ISO date, inclusive. A transaction dated exactly here is included. */
export type AsOf = string

export type ReconstructionInput = {
  transactions: readonly DomainTransaction[]
  cashTransactions: readonly DomainCashTransaction[]
  /** Dividends already translated into the base currency, with the date they were received. */
  dividends: readonly { date: string; amount: number }[]
  baseCurrency: Currency
}

/**
 * What the portfolio was, as of a date — everything derivable without a price.
 *
 * `marketValue` is deliberately absent. A shape that carried it would invite somebody to default it
 * to zero for a date with no snapshot, and a portfolio worth "0" on a Tuesday in March is the exact
 * class of silently-wrong figure this codebase spends its comments avoiding.
 */
export type PortfolioState = {
  asOf: AsOf
  baseCurrency: Currency
  positions: Position[]
  trades: RealizedTrade[]
  /** Cost basis of shares held on this date, buy fees included. */
  investedCapital: number
  realizedPnl: number
  cashBalance: number
  /** Deposits minus withdrawals up to this date. External money, never a return. */
  netContributed: number
  dividendsReceived: number
  feesPaid: number
  transactionCount: number
  openPositionCount: number
}

/** Transactions that had happened by a date. The whole of the "historical" part. */
function upTo<T extends { tradeDate?: string; occurredOn?: string; date?: string }>(
  rows: readonly T[],
  asOf: AsOf,
): T[] {
  return rows.filter((row) => {
    const at = row.tradeDate ?? row.occurredOn ?? row.date
    return typeof at === "string" && at.slice(0, 10) <= asOf
  })
}

/**
 * The portfolio as of `asOf`.
 *
 * Note what this does *not* do: it does not read a stored past state, and it does not interpolate.
 * It replays. A portfolio reconstructed for a date is the portfolio that date's transactions
 * produce, which means correcting a transaction from last March corrects every figure about last
 * March — as it should, because the transaction is the source of truth and the reconstruction is a
 * view of it.
 */
export function reconstructAt(input: ReconstructionInput, asOf: AsOf): PortfolioState {
  const transactions = upTo(input.transactions, asOf)
  const cashTransactions = upTo(input.cashTransactions, asOf)
  const dividends = upTo(input.dividends, asOf)

  // The existing engine, unchanged. This is the whole point of the module.
  const { positions, trades } = replayPortfolio(transactions)
  const cash = computeCash(
    transactions,
    cashTransactions,
    dividends.map((d) => ({ netAmount: d.amount, paidOn: d.date })),
  )

  const open = positions.filter((p) => p.quantity > 0)

  return {
    asOf,
    baseCurrency: input.baseCurrency,
    positions,
    trades,
    investedCapital: sumBy(open, (p) => p.investedValue),
    realizedPnl: sumBy(positions, (p) => p.realizedPnl),
    cashBalance: cash.balance,
    netContributed: cash.netContributed,
    dividendsReceived: sumBy(dividends, (d) => d.amount),
    feesPaid: sumBy(transactions, (t) => t.fee),
    transactionCount: transactions.length,
    openPositionCount: open.length,
  }
}

// ---------------------------------------------------------------- capital flows

export const FLOW_KINDS = ["DEPOSIT", "WITHDRAWAL"] as const
export type FlowKind = (typeof FLOW_KINDS)[number]

export type CapitalFlow = { date: string; kind: FlowKind; amount: number }

/**
 * External money moving in and out, between two dates.
 *
 * **A buy is not a capital flow.** Moving cash into a stock changes the shape of a portfolio, not
 * its size — the money was already inside. Only a capital flow crosses the boundary, and
 * that distinction is what separates "the portfolio grew" from "the portfolio was fed".
 *
 * `from` is exclusive and `to` inclusive, so consecutive periods neither double-count a flow nor
 * drop one between them.
 */
export function capitalFlowsBetween(
  cashTransactions: readonly DomainCashTransaction[],
  from: AsOf,
  to: AsOf,
): CapitalFlow[] {
  return cashTransactions
    .filter((c) => {
      const at = c.occurredOn.slice(0, 10)
      return at > from && at <= to && isCapitalFlow(c.kind)
    })
    .map((c) => ({
      date: c.occurredOn.slice(0, 10),
      // Direction comes from the shared table, never from a test for one kind: a fee is an
      // outflow but not a capital flow, and an unrecognised kind must not default to either.
      kind: CASH_FLOW_DIRECTION[c.kind] === 1 ? ("DEPOSIT" as const) : ("WITHDRAWAL" as const),
      amount: c.amount,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** Net external money added over a period. Negative when more was withdrawn than paid in. */
export function netFlow(flows: readonly CapitalFlow[]): number {
  return flows.reduce(
    (total, flow) => (flow.kind === "DEPOSIT" ? add(total, flow.amount) : add(total, -flow.amount)),
    0,
  )
}

// ---------------------------------------------------------------- valued history

/**
 * How much of a historical point Stockly can actually stand behind.
 *
 * The distinction that matters is between `PARTIAL` and `COMPLETE`, and it exists because a total
 * that quietly excluded two holdings looks exactly like a total that included them. A `PARTIAL`
 * point carries a value **and** the count of what is missing from it; the UI shows both or neither.
 */
export const HISTORY_QUALITIES = ["COMPLETE", "PARTIAL", "STALE", "UNAVAILABLE"] as const
export type HistoryQuality = (typeof HISTORY_QUALITIES)[number]

export type ValuedPoint = {
  date: string
  /** Stocks plus cash, in the base currency. **Null when it could not be established.** */
  totalValue: number | null
  investedCapital: number
  cashBalance: number
  netContributed: number
  realizedPnl: number
  /** Total value minus invested capital and cash. Null whenever `totalValue` is. */
  unrealizedPnl: number | null
  quality: HistoryQuality
  /** Named when quality is not COMPLETE, so a gap can be explained rather than merely shown. */
  reason: string | null
}

/**
 * A point's quality, decided in one place.
 *
 * `STALE` outranks `PARTIAL`: a value assembled from yesterday's prices is a statement about
 * yesterday whatever else is true of it, and saying "partial" would understate the problem.
 */
export function qualityOf({
  hasValue,
  missingHoldings,
  stale,
}: {
  hasValue: boolean
  missingHoldings: number
  stale: boolean
}): { quality: HistoryQuality; reason: string | null } {
  if (!hasValue) return { quality: "UNAVAILABLE", reason: "No valuation recorded for this date." }
  if (stale) return { quality: "STALE", reason: "Valued using prices from an earlier date." }
  if (missingHoldings > 0) {
    return {
      quality: "PARTIAL",
      reason: `${missingHoldings} holding${missingHoldings === 1 ? "" : "s"} could not be valued and ${
        missingHoldings === 1 ? "is" : "are"
      } excluded from this total.`,
    }
  }
  return { quality: "COMPLETE", reason: null }
}

// ---------------------------------------------------------------- period comparison

export const HISTORY_PERIODS = ["1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "MAX"] as const
export type HistoryPeriod = (typeof HISTORY_PERIODS)[number]

/*
 * The words for this enum live in the `enums` namespace, keyed by the same values, in every
 * language Stockly ships. A `Record<Enum, string>` of English here would be the copy the other
 * languages drift away from, and this module is the one that must hold no prose at all.
 */

/** Where a period starts, in calendar terms. MAX has no start. */
export function periodStart(period: HistoryPeriod, now: Date): string | null {
  const at = new Date(now)
  switch (period) {
    case "1W":
      at.setUTCDate(at.getUTCDate() - 7)
      break
    case "1M":
      at.setUTCMonth(at.getUTCMonth() - 1)
      break
    case "3M":
      at.setUTCMonth(at.getUTCMonth() - 3)
      break
    case "6M":
      at.setUTCMonth(at.getUTCMonth() - 6)
      break
    case "YTD":
      return `${now.getUTCFullYear()}-01-01`
    case "1Y":
      at.setUTCFullYear(at.getUTCFullYear() - 1)
      break
    case "3Y":
      at.setUTCFullYear(at.getUTCFullYear() - 3)
      break
    case "MAX":
      return null
  }
  return at.toISOString().slice(0, 10)
}

/**
 * The equivalent period immediately before this one, for a like-for-like comparison.
 *
 * Same length, ending where the current period begins. Null for MAX, which has no "previous" —
 * inventing one would mean comparing a portfolio's whole life against a window of the same length
 * before it existed.
 */
export function previousPeriod(
  period: HistoryPeriod,
  now: Date,
): { start: string; end: string } | null {
  const start = periodStart(period, now)
  if (start === null) return null

  const currentStart = Date.parse(`${start}T00:00:00Z`)
  const currentEnd = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)
  const length = currentEnd - currentStart
  if (!Number.isFinite(length) || length <= 0) return null

  return {
    start: new Date(currentStart - length).toISOString().slice(0, 10),
    end: start,
  }
}

// ---------------------------------------------------------------- monthly buckets

export type MonthKey = string // "2026-03"

export function monthOf(date: string): MonthKey {
  return date.slice(0, 7)
}

/** Every month between two dates, inclusive, so a month with no activity is still a row. */
export function monthsBetween(from: string, to: string): MonthKey[] {
  const months: MonthKey[] = []
  const start = new Date(`${from.slice(0, 7)}-01T00:00:00Z`)
  const end = new Date(`${to.slice(0, 7)}-01T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return months

  const cursor = new Date(start)
  // Bounded: a hundred years of months is far past anything real and stops a bad date looping.
  while (cursor <= end && months.length < 1_200) {
    months.push(cursor.toISOString().slice(0, 7))
    cursor.setUTCMonth(cursor.getUTCMonth() + 1)
  }
  return months
}

// ---------------------------------------------------------------- turnover

export type Turnover = {
  buyVolume: number
  sellVolume: number
  /** Trading volume relative to average portfolio value. Null when that average is unknown. */
  ratio: number | null
  /** How many orders produced it — a different question from turnover, and never conflated. */
  orderCount: number
}

/**
 * Turnover over a period.
 *
 * Volume is money traded, not orders placed: fifty small rebalancing trades and one large purchase
 * are very different turnovers and identical order counts, so both are reported and neither is
 * called the other.
 *
 * The ratio uses the lesser of buys and sells over average portfolio value — the standard
 * definition, which measures how much of the portfolio actually *turned over* rather than how much
 * money passed through it. It is `null` without an average value, because dividing by a portfolio
 * size nobody knows produces a number that looks like a rate and is not one.
 */
export function computeTurnover(
  transactions: readonly DomainTransaction[],
  from: AsOf,
  to: AsOf,
  averageValue: number | null,
): Turnover {
  const inPeriod = transactions.filter((t) => {
    const at = t.tradeDate.slice(0, 10)
    return at > from && at <= to
  })

  const buyVolume = sumBy(
    inPeriod.filter((t) => t.side === "buy"),
    (t) => t.quantity * t.price,
  )
  const sellVolume = sumBy(
    inPeriod.filter((t) => t.side === "sell"),
    (t) => t.quantity * t.price,
  )

  return {
    buyVolume,
    sellVolume,
    ratio:
      averageValue !== null && averageValue > 0
        ? (Math.min(buyVolume, sellVolume) / averageValue) * 100
        : null,
    orderCount: inPeriod.length,
  }
}

// ---------------------------------------------------------------- fee impact

export type FeeImpact = {
  total: number
  /** Fees as a percentage of invested capital. Null when nothing has been invested. */
  ofInvestedCapital: number | null
  /** Fees as a percentage of money traded. Null when nothing has been traded. */
  ofTradingVolume: number | null
}

export function computeFeeImpact(
  transactions: readonly DomainTransaction[],
  investedCapital: number,
): FeeImpact {
  const total = sumBy(transactions, (t) => t.fee)
  const volume = sumBy(transactions, (t) => t.quantity * t.price)

  return {
    total,
    // Null rather than 0: a portfolio that has invested nothing has not paid 0% in fees, it has no
    // ratio at all — and 0% would read as "fees are negligible" rather than "there is no answer".
    ofInvestedCapital: investedCapital > 0 ? (total / investedCapital) * 100 : null,
    ofTradingVolume: volume > 0 ? (total / volume) * 100 : null,
  }
}
