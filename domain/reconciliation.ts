import { roundTo, subtract, percentOf, quantize, QUANTITY_SCALE } from "./money"
import { symbolKey, type Currency, type MarketId } from "./market"
import type { CurrencyCashBalance } from "./cash"
import type { Position } from "./types"

/**
 * Reconciliation: comparing what a broker says against what Stockly derived.
 *
 * The whole module is a **comparison**, and the invariant that keeps it safe is that it has no way
 * to be anything else — it takes two readings and returns a description of how they differ. There
 * is no client here, no writer, no id of anything that could be updated. A difference becomes a
 * change only when a user approves an adjustment, and an adjustment is an ordinary transaction
 * created by the ordinary route.
 *
 * The second rule, which matters more than it sounds: **a difference is not a verdict about who is
 * wrong.** A broker statement is a reading taken at a moment, under settlement conventions Stockly
 * does not model, of an account it cannot see. So every difference reports *candidate causes* and
 * stops. "Your holdings are wrong" is a sentence this module is not allowed to produce.
 *
 * Trade-level reconciliation already exists in `domain/import/reconcile.ts` and is not repeated
 * here; this is the position and cash half, which had nowhere to live.
 *
 * Pure: no database, no network, no framework.
 */

// ---------------------------------------------------------------- run vocabulary

/**
 * A run's lifecycle.
 *
 * `COMPLETED_WITH_WARNINGS` exists so a run that finished but found unexplained differences is not
 * reported as a clean success, and `FAILED` so a run that could not finish is never represented as
 * an empty successful one — an empty result and a result that could not be produced look identical
 * on a screen and mean opposite things.
 */
export const RECONCILIATION_STATUSES = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "COMPLETED_WITH_WARNINGS",
  "FAILED",
] as const
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number]

export const RECONCILIATION_SCOPES = ["TRANSACTIONS", "POSITIONS", "CASH"] as const
export type ReconciliationScope = (typeof RECONCILIATION_SCOPES)[number]

// ---------------------------------------------------------------- positions

/**
 * A position as a broker reports it.
 *
 * `averageCost` is nullable because plenty of statements do not carry one, and a missing cost is
 * not a cost of zero — a zero would report every such position as a 100% discrepancy.
 */
export type BrokerPosition = {
  symbol: string
  market: MarketId
  quantity: number
  averageCost: number | null
  currency: Currency
}

export const POSITION_DIFF_STATUSES = [
  "MATCHED",
  "QUANTITY_DIFFERS",
  "COST_DIFFERS",
  "MISSING_IN_STOCKLY",
  "MISSING_IN_BROKER",
  "CURRENCY_MISMATCH",
] as const
export type PositionDiffStatus = (typeof POSITION_DIFF_STATUSES)[number]

/**
 * Why two share counts might legitimately differ, in the order worth checking.
 *
 * Every one of these is a statement about *data*, never about a decision. None of them tells the
 * user to do anything, and the list is deliberately plural: presenting one cause as the explanation
 * would be a diagnosis this module cannot support.
 */
export const POSITION_CAUSES = {
  SPLIT_RATIO:
    "The two counts differ by a clean ratio, which is what an unrecorded split or reverse split looks like.",
  MISSING_TRANSACTION: "A trade on the statement may not have been imported or entered.",
  EXTRA_TRANSACTION: "A trade recorded in Stockly may not have settled, or may belong to another account.",
  SETTLEMENT_TIMING: "A trade near the statement date may settle on either side of it.",
  TRANSFER: "Shares moved between accounts appear in one and not the other.",
  SYMBOL_CHANGE: "A ticker change lists the same company under two symbols.",
  COST_METHOD:
    "Stockly uses weighted-average cost. A broker reporting FIFO will disagree after a partial sale.",
  COST_NOT_REPORTED: "The statement reports no average cost for this position.",
  CURRENCY: "The statement reports this position in a different currency than its market's.",
} as const
export type PositionCause = keyof typeof POSITION_CAUSES

/** Quantities this far apart are treated as equal — a statement rounds, and 1e-8 is not a share. */
const QUANTITY_TOLERANCE = 1e-6

/** Average cost within this percentage is treated as agreement, absorbing statement rounding. */
export const COST_TOLERANCE_PCT = 0.5

export type PositionDifference = {
  status: PositionDiffStatus
  symbol: string
  market: MarketId
  /** Null when the side has no such position at all — never 0, which is a position of no shares. */
  brokerQuantity: number | null
  stocklyQuantity: number | null
  /** broker − Stockly. Null when either side is absent. */
  quantityDifference: number | null
  brokerAverageCost: number | null
  stocklyAverageCost: number | null
  /** Percentage the broker's cost sits above Stockly's. Null when either is missing. */
  costDifferencePct: number | null
  currency: Currency | null
  causes: readonly PositionCause[]
}

/**
 * Whether two share counts differ by a ratio a split would produce.
 *
 * Only clean ratios count. A position that is 2×, 3×, 10× or a half of the other is the signature
 * of an unrecorded split; one that is 1.37× is just a different number, and calling that a split
 * would be a guess dressed as a finding.
 */
function looksLikeSplit(broker: number, stockly: number): boolean {
  if (broker <= 0 || stockly <= 0) return false
  const ratio = broker / stockly
  for (const candidate of [2, 3, 4, 5, 6, 8, 10, 20, 100]) {
    if (Math.abs(ratio - candidate) < 1e-6) return true
    if (Math.abs(ratio - 1 / candidate) < 1e-9) return true
  }
  return false
}

function positionCauses(
  broker: BrokerPosition | null,
  stockly: Position | null,
  status: PositionDiffStatus,
): PositionCause[] {
  const causes: PositionCause[] = []

  if (status === "MISSING_IN_STOCKLY") {
    causes.push("MISSING_TRANSACTION", "TRANSFER", "SYMBOL_CHANGE")
    return causes
  }
  if (status === "MISSING_IN_BROKER") {
    causes.push("EXTRA_TRANSACTION", "TRANSFER", "SYMBOL_CHANGE")
    return causes
  }
  if (status === "CURRENCY_MISMATCH") {
    causes.push("CURRENCY")
    return causes
  }
  if (status === "QUANTITY_DIFFERS" && broker && stockly) {
    if (looksLikeSplit(broker.quantity, stockly.quantity)) causes.push("SPLIT_RATIO")
    causes.push("MISSING_TRANSACTION", "SETTLEMENT_TIMING", "TRANSFER")
    return causes
  }
  if (status === "COST_DIFFERS") {
    causes.push("COST_METHOD", "MISSING_TRANSACTION", "SPLIT_RATIO")
    return causes
  }
  return causes
}

/**
 * Compares broker-reported positions against the positions the engine derived.
 *
 * Both sides are keyed by `symbolKey`, market included: the same three letters are a listing in New
 * York and a different company in Bangkok, and matching on the bare symbol would reconcile two
 * unrelated instruments into one satisfying zero.
 *
 * Closed positions — quantity zero — are not reported as missing from the statement. A position the
 * user sold out of is absent from a broker's holdings page because it is absent, not because
 * anything disagrees.
 */
export function reconcilePositions(
  brokerPositions: readonly BrokerPosition[],
  positions: readonly Position[],
): PositionDifference[] {
  const byKey = new Map<string, Position>()
  for (const position of positions) {
    if (position.quantity <= 0) continue
    byKey.set(symbolKey(position.symbol, position.market), position)
  }

  const out: PositionDifference[] = []
  const seen = new Set<string>()

  for (const broker of brokerPositions) {
    const key = symbolKey(broker.symbol.toUpperCase(), broker.market)
    seen.add(key)
    const stockly = byKey.get(key) ?? null

    if (!stockly) {
      out.push({
        status: "MISSING_IN_STOCKLY",
        symbol: broker.symbol.toUpperCase(),
        market: broker.market,
        brokerQuantity: broker.quantity,
        stocklyQuantity: null,
        quantityDifference: null,
        brokerAverageCost: broker.averageCost,
        stocklyAverageCost: null,
        costDifferencePct: null,
        currency: broker.currency,
        causes: positionCauses(broker, null, "MISSING_IN_STOCKLY"),
      })
      continue
    }

    const quantityDifference = quantize(
      subtract(broker.quantity, stockly.quantity, QUANTITY_SCALE),
      QUANTITY_SCALE,
    )
    // Null rather than 0 when the statement reports no cost: an unreported figure is not agreement.
    const costDifferencePct =
      broker.averageCost === null || stockly.averageCost <= 0
        ? null
        : percentOf(subtract(broker.averageCost, stockly.averageCost), stockly.averageCost)

    const status: PositionDiffStatus =
      broker.currency !== stockly.currency
        ? "CURRENCY_MISMATCH"
        : Math.abs(quantityDifference) > QUANTITY_TOLERANCE
          ? "QUANTITY_DIFFERS"
          : costDifferencePct !== null && Math.abs(costDifferencePct) > COST_TOLERANCE_PCT
            ? "COST_DIFFERS"
            : "MATCHED"

    const causes = positionCauses(broker, stockly, status)
    if (status === "MATCHED" && broker.averageCost === null) causes.push("COST_NOT_REPORTED")

    out.push({
      status,
      symbol: stockly.symbol,
      market: stockly.market,
      brokerQuantity: broker.quantity,
      stocklyQuantity: stockly.quantity,
      quantityDifference,
      brokerAverageCost: broker.averageCost,
      stocklyAverageCost: stockly.averageCost,
      costDifferencePct: costDifferencePct === null ? null : roundTo(costDifferencePct, 4),
      currency: stockly.currency,
      causes,
    })
  }

  for (const [key, stockly] of byKey) {
    if (seen.has(key)) continue
    out.push({
      status: "MISSING_IN_BROKER",
      symbol: stockly.symbol,
      market: stockly.market,
      brokerQuantity: null,
      stocklyQuantity: stockly.quantity,
      quantityDifference: null,
      brokerAverageCost: null,
      stocklyAverageCost: stockly.averageCost,
      costDifferencePct: null,
      currency: stockly.currency,
      causes: positionCauses(null, stockly, "MISSING_IN_BROKER"),
    })
  }

  return out.sort((a, b) => symbolKey(a.symbol, a.market).localeCompare(symbolKey(b.symbol, b.market)))
}

// ---------------------------------------------------------------- cash

/** A balance as a broker reports it, in the currency it is actually denominated in. */
export type BrokerCashBalance = {
  currency: Currency
  balance: number
}

export const CASH_DIFF_STATUSES = [
  "MATCHED",
  "DIFFERS",
  "MISSING_IN_STOCKLY",
  "MISSING_IN_BROKER",
] as const
export type CashDiffStatus = (typeof CASH_DIFF_STATUSES)[number]

export const CASH_CAUSES = {
  MISSING_MOVEMENT: "A deposit, withdrawal, fee, tax or interest payment may not have been recorded.",
  MISSING_TRADE: "A trade on the statement may not have been imported, so its cash never moved.",
  MISSING_DIVIDEND: "A dividend may have been paid but not recorded.",
  SETTLEMENT_TIMING: "A trade near the statement date settles on one side of it and not the other.",
  UNRECORDED_FUNDING: "Trades were recorded without the deposit that funded them.",
  NO_STOCKLY_BALANCE: "Stockly holds no movement at all in this currency.",
  NO_BROKER_BALANCE: "The statement reports no balance in this currency.",
} as const
export type CashCause = keyof typeof CASH_CAUSES

/** Balances this far apart are equal. A statement rounds to the currency's smallest unit. */
const CASH_TOLERANCE = 0.005

export type CashDifference = {
  status: CashDiffStatus
  currency: Currency
  /** Null when the side reports nothing in this currency at all — never 0, which is a real balance. */
  brokerBalance: number | null
  stocklyBalance: number | null
  /** broker − Stockly, in `currency`. Null when either side is absent. */
  difference: number | null
  causes: readonly CashCause[]
}

/**
 * Compares broker cash balances against Stockly's ledger, **one currency at a time**.
 *
 * Nothing is converted and nothing is summed across currencies. A dollar balance is reconciled
 * against a dollar balance; if a statement reports a currency Stockly has never seen a movement in,
 * that is reported as its own row rather than folded into a translated total where today's exchange
 * rate would masquerade as a discrepancy.
 *
 * There is deliberately no "total difference" figure. It would have to be denominated in something,
 * and any currency it were stated in would make it a function of today's rate rather than of the
 * ledger.
 */
export function reconcileCash(
  brokerBalances: readonly BrokerCashBalance[],
  stocklyBalances: readonly CurrencyCashBalance[],
): CashDifference[] {
  const byCurrency = new Map(stocklyBalances.map((b) => [b.currency, b]))
  const out: CashDifference[] = []
  const seen = new Set<Currency>()

  for (const broker of brokerBalances) {
    seen.add(broker.currency)
    const stockly = byCurrency.get(broker.currency)

    if (!stockly) {
      out.push({
        status: "MISSING_IN_STOCKLY",
        currency: broker.currency,
        brokerBalance: broker.balance,
        stocklyBalance: null,
        difference: null,
        causes: ["NO_STOCKLY_BALANCE", "MISSING_MOVEMENT"],
      })
      continue
    }

    const difference = subtract(broker.balance, stockly.balance)
    const matched = Math.abs(difference) <= CASH_TOLERANCE

    const causes: CashCause[] = []
    if (!matched) {
      causes.push("MISSING_MOVEMENT", "MISSING_TRADE", "MISSING_DIVIDEND", "SETTLEMENT_TIMING")
      // A ledger showing less cash than the broker, having never been funded, has one obvious gap.
      if (stockly.netContributed === 0 && stockly.buyCosts > 0) causes.push("UNRECORDED_FUNDING")
    }

    out.push({
      status: matched ? "MATCHED" : "DIFFERS",
      currency: broker.currency,
      brokerBalance: broker.balance,
      stocklyBalance: stockly.balance,
      difference: roundTo(difference, 6),
      causes,
    })
  }

  for (const stockly of stocklyBalances) {
    if (seen.has(stockly.currency)) continue
    out.push({
      status: "MISSING_IN_BROKER",
      currency: stockly.currency,
      brokerBalance: null,
      stocklyBalance: stockly.balance,
      difference: null,
      causes: ["NO_BROKER_BALANCE"],
    })
  }

  return out.sort((a, b) => a.currency.localeCompare(b.currency))
}

// ---------------------------------------------------------------- summary

export type ReconciliationSummary = {
  positions: { total: number; matched: number; differences: number }
  cash: { total: number; matched: number; differences: number }
  /** Populated from `domain/import/reconcile.ts` when a statement's trades were compared too. */
  transactions: { total: number; matched: number; differences: number } | null
}

/**
 * A run's status, derived from its findings rather than set by hand.
 *
 * Anything unexplained leaves the run `COMPLETED_WITH_WARNINGS`. A clean run is one where every
 * comparison agreed — which is a stronger and more useful claim than "it finished".
 */
export function statusFor(summary: ReconciliationSummary): ReconciliationStatus {
  const differences =
    summary.positions.differences + summary.cash.differences + (summary.transactions?.differences ?? 0)
  return differences > 0 ? "COMPLETED_WITH_WARNINGS" : "COMPLETED"
}

export function summarise(
  positions: readonly PositionDifference[],
  cash: readonly CashDifference[],
  transactions: { total: number; matched: number; differences: number } | null = null,
): ReconciliationSummary {
  return {
    positions: {
      total: positions.length,
      matched: positions.filter((p) => p.status === "MATCHED").length,
      differences: positions.filter((p) => p.status !== "MATCHED").length,
    },
    cash: {
      total: cash.length,
      matched: cash.filter((c) => c.status === "MATCHED").length,
      differences: cash.filter((c) => c.status !== "MATCHED").length,
    },
    transactions,
  }
}
