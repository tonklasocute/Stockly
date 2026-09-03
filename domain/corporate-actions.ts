import { multiply, divide, quantize, MONEY_SCALE, QUANTITY_SCALE } from "./money"
import { symbolKey, type MarketId } from "./market"
import type { DomainTransaction, Position } from "./types"

/**
 * Share adjustments: what a split actually does to a portfolio.
 *
 * A split is the one corporate action that changes a number the engine derives without a
 * transaction existing for it. Two hundred shares appear where a hundred were, and no money moved.
 * That leaves exactly three ways to represent it, and only one of them is honest:
 *
 *   1. Rewrite the stored transactions.      Destroys the record of what the user actually did.
 *   2. Record a buy for the new shares.      Invents a purchase, and with it a cost basis and a
 *                                            realized P&L that never happened.
 *   3. Record the adjustment separately and  Transactions stay exactly as entered; the adjustment
 *      apply it when replaying.              is a stored, auditable, reversible fact of its own.
 *
 * This module is (3). It is a **filter in front of the existing engine**, in the same shape as
 * `reconstructAt` in `domain/history.ts`: transactions in, transactions out, and `replayPortfolio`
 * is untouched. Removing every adjustment returns every figure to what it was.
 *
 * Pure: no database, no network, no framework.
 */

/**
 * One split, as the user confirmed it.
 *
 * `numerator:denominator` is read the way an exchange announces it — a 2-for-1 split is
 * `{ numerator: 2, denominator: 1 }`, a 1-for-10 reverse split is `{ numerator: 1, denominator: 10 }`.
 * There is no separate "reverse" flag: a reverse split is a ratio below one and every rule below
 * follows from the arithmetic rather than from a branch.
 */
export type ShareAdjustment = {
  symbol: string
  market: MarketId
  /**
   * The first trading day the new share count applies to.
   *
   * A trade **on** this date is already quoted in post-split terms, so the boundary is strict:
   * only transactions strictly before it are adjusted.
   */
  effectiveDate: string
  numerator: number
  denominator: number
}

/** The multiplier applied to a share count. Above 1 for a split, below 1 for a reverse split. */
export function ratioOf(adjustment: Pick<ShareAdjustment, "numerator" | "denominator">): number {
  return adjustment.numerator / adjustment.denominator
}

/**
 * Parses an exchange's "4:1" into a ratio.
 *
 * Returns null rather than a guess for anything it cannot read, including a zero on either side:
 * a ratio of zero would erase a position, and one divided by zero is not a number. The provider
 * field this reads is free text on `corporate_events`, so it is never trusted.
 */
export function parseRatio(input: string | null | undefined): { numerator: number; denominator: number } | null {
  if (!input) return null
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:\-/ ]\s*(\d+(?:\.\d+)?)\s*$/.exec(input)
  if (!match) return null
  const numerator = Number(match[1])
  const denominator = Number(match[2])
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null
  if (numerator <= 0 || denominator <= 0) return null
  return { numerator, denominator }
}

/** Whether the ratio shrinks the share count. Reported, never used to branch the arithmetic. */
export function isReverseSplit(adjustment: Pick<ShareAdjustment, "numerator" | "denominator">): boolean {
  return ratioOf(adjustment) < 1
}

function keyOf(item: { symbol: string; market?: MarketId }): string {
  return symbolKey(item.symbol.toUpperCase(), item.market ?? "US")
}

/**
 * Restates transactions in post-split terms.
 *
 * Quantity is multiplied by the ratio and price divided by it, so `quantity × price` — the money
 * that actually left the account — is preserved. The fee is never touched: a commission was paid
 * in cash, once, and a split does not retroactively change what it cost to trade.
 *
 * Adjustments compound, oldest first, which is what makes two splits on one instrument correct
 * rather than merely applied twice.
 *
 * **Total cost is preserved to the scale of the money type, not exactly.** A 3-for-1 split of a
 * $10 purchase is $3.333333 a share in any fixed-decimal representation, and no arrangement of the
 * arithmetic makes 3 × 3.333333 equal 10. The residue is bounded by one unit of `MONEY_SCALE` per
 * share and is far below anything displayed; `corporate-actions.test.ts` pins the bound so a future
 * change cannot widen it quietly.
 */
export function applyShareAdjustments(
  transactions: readonly DomainTransaction[],
  adjustments: readonly ShareAdjustment[],
): DomainTransaction[] {
  if (adjustments.length === 0) return [...transactions]

  const byInstrument = new Map<string, ShareAdjustment[]>()
  for (const adjustment of adjustments) {
    const key = keyOf(adjustment)
    const list = byInstrument.get(key) ?? []
    list.push(adjustment)
    byInstrument.set(key, list)
  }
  for (const list of byInstrument.values()) {
    list.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0))
  }

  return transactions.map((tx) => {
    const applicable = byInstrument.get(keyOf(tx))
    if (!applicable) return tx

    let quantity = tx.quantity
    let price = tx.price
    let changed = false

    for (const adjustment of applicable) {
      // Strictly before: a trade on the effective date is already priced post-split.
      if (tx.tradeDate.slice(0, 10) >= adjustment.effectiveDate.slice(0, 10)) continue
      const ratio = ratioOf(adjustment)
      quantity = multiply(quantity, ratio, QUANTITY_SCALE)
      price = divide(price, ratio, MONEY_SCALE)
      changed = true
    }

    return changed ? { ...tx, quantity, price } : tx
  })
}

/**
 * What a split would do to one position, for the confirmation screen.
 *
 * Computed from the position the engine already derived rather than from the transactions, because
 * this is a preview: it must not be able to write, and it must show the same numbers the user is
 * looking at on the holdings table.
 */
export type ShareAdjustmentPreview = {
  symbol: string
  market: MarketId
  quantityBefore: number
  quantityAfter: number
  averageCostBefore: number
  averageCostAfter: number
  /** Unchanged by construction — shown so the user can see that no money moves. */
  investedValue: number
  /**
   * The part of a share the new count leaves over, when the ratio does not divide the position
   * evenly. A broker settles this as cash in lieu; Stockly keeps it and says so, because silently
   * rounding it away deletes shares the user owns.
   *
   * Zero when the split divides evenly, which is the common case.
   */
  fractionalShares: number
}

export function previewShareAdjustment(
  position: Pick<Position, "symbol" | "market" | "quantity" | "averageCost" | "investedValue">,
  adjustment: Pick<ShareAdjustment, "numerator" | "denominator">,
): ShareAdjustmentPreview {
  const ratio = ratioOf(adjustment)
  const quantityAfter = multiply(position.quantity, ratio, QUANTITY_SCALE)
  const fraction = quantize(quantityAfter - Math.floor(quantityAfter), QUANTITY_SCALE)

  return {
    symbol: position.symbol,
    market: position.market,
    quantityBefore: position.quantity,
    quantityAfter,
    averageCostBefore: position.averageCost,
    averageCostAfter: quantityAfter > 0 ? divide(position.investedValue, quantityAfter, QUANTITY_SCALE) : 0,
    investedValue: position.investedValue,
    fractionalShares: fraction,
  }
}

/**
 * The corporate-action types Stockly can represent as a portfolio adjustment, and the ones it
 * deliberately cannot.
 *
 * A merger, a rights offering and a tender offer all need cost basis **allocated** between two
 * instruments, or between an instrument and cash, using a ratio only the issuer publishes. Stockly
 * stores no such ratio, and a basis invented to make a position balance is worse than an absent
 * one: it flows into realized P&L the moment the position is sold, and nothing downstream can tell
 * it apart from a figure that was actually earned. They are listed for review and applied by hand,
 * as ordinary transactions the user records.
 */
export const ADJUSTABLE_EVENT_TYPES = ["SPLIT", "REVERSE_SPLIT"] as const
export type AdjustableEventType = (typeof ADJUSTABLE_EVENT_TYPES)[number]

export function isAdjustable(eventType: string): eventType is AdjustableEventType {
  return (ADJUSTABLE_EVENT_TYPES as readonly string[]).includes(eventType)
}

/** Why an event that changes a portfolio cannot be applied automatically. Shown beside it. */
export const UNADJUSTABLE_REASON: Record<string, string> = {
  MERGER:
    "A merger allocates cost basis between the shares and cash you receive, using a ratio only the issuer publishes. Record the result as transactions.",
  ACQUISITION:
    "An acquisition allocates cost basis between the shares and cash you receive, using a ratio only the issuer publishes. Record the result as transactions.",
  RIGHTS_OFFERING:
    "A rights offering has a cost basis only if you took it up, at a subscription price Stockly does not store. Record what you actually did.",
  TENDER_OFFER:
    "A tender offer changes nothing unless you accepted it. Record the resulting transactions if you did.",
  DIVIDEND: "Record the dividend you were actually paid — the amount on your statement, not the declared rate.",
  EX_DIVIDEND: "A notice only. The dividend you were paid is the row you record.",
}
