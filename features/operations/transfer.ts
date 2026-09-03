import "server-only"

import { symbolKey, toMarket, type MarketId } from "@/domain/market"
import { computePositions } from "@/domain/holdings"
import { applyShareAdjustments } from "@/domain/corporate-actions"
import type { Position } from "@/domain/types"
import { listTransactions, toDomain } from "@/features/transactions/queries"
import { adjustmentsFor } from "./queries"
import type { TransferInput } from "./schema"

/**
 * Transferring holdings between two of the user's own portfolios.
 *
 * **A transfer re-parents the transactions.** It does not sell in one portfolio and buy in the
 * other, and that is the entire design rather than an implementation detail: a synthesised
 * sell-and-buy pair books a realized profit or loss nobody made, and nothing downstream — not the
 * trade statistics, not the win rate, not TWR — could tell it apart from one that was earned.
 *
 * Because the rows are the same rows, quantity, cost basis, acquisition dates, fees, currency and
 * market are preserved by construction. There is nothing to recompute, so there is nothing to drift.
 *
 * The preview and the apply are the same computation. The preview simply does not call the writer.
 */

export type TransferPreview = {
  /** The positions that would move, exactly as they stand today. */
  positions: Position[]
  transactionCount: number
  adjustmentCount: number
  /**
   * Always zero, and typed so.
   *
   * Stated rather than omitted because it is the question a reader has: re-parenting a row cannot
   * realize anything, so a transfer produces no gain, no loss and no taxable event.
   */
  realizedPnl: 0
  /** Whether anything would move at all. A transfer of nothing is refused rather than reported OK. */
  empty: boolean
}

export async function previewTransfer(input: TransferInput): Promise<TransferPreview> {
  const [rows, adjustments] = await Promise.all([
    listTransactions(input.fromPortfolioId),
    adjustmentsFor(input.fromPortfolioId),
  ])

  const key = input.symbol && input.market ? symbolKey(input.symbol, input.market) : null
  const matching = rows.filter(
    (row) => key === null || symbolKey(row.symbol, toMarket(row.market)) === key,
  )

  /*
   * Priced through the same engine, with the same split adjustments, so the preview shows the
   * numbers the user is already looking at on the holdings table rather than a second opinion.
   */
  const positions = computePositions(
    applyShareAdjustments(
      toDomain(matching),
      key === null
        ? adjustments
        : adjustments.filter((a) => symbolKey(a.symbol, a.market as MarketId) === key),
    ),
  ).filter((position) => position.quantity > 0)

  return {
    positions,
    transactionCount: matching.length,
    adjustmentCount: key === null
      ? adjustments.length
      : adjustments.filter((a) => symbolKey(a.symbol, a.market as MarketId) === key).length,
    realizedPnl: 0,
    empty: matching.length === 0,
  }
}
