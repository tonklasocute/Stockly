import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  reconcileCash,
  reconcilePositions,
  statusFor,
  summarise,
  type CashDifference,
  type PositionDifference,
} from "@/domain/reconciliation"
import { loadAnalytics } from "@/features/analytics/portfolio-analytics"
import { logger } from "@/lib/log"
import type { Database, ReconciliationItemRow, ReconciliationRunRow } from "@/types/database"
import type { ReconciliationRequest } from "./schema"

/**
 * Running a reconciliation.
 *
 * **This function compares and records. It never changes a financial figure**, and the shape is
 * what enforces that rather than a comment: it reads the portfolio through `loadAnalytics` — the
 * same cached pass the dashboard uses, so a run can never disagree with the screen the user is
 * looking at — and everything it writes goes to `reconciliation_runs` and `reconciliation_items`.
 * Neither table is read by any calculation. Delete every row in both and every number is identical.
 *
 * Running it twice on the same statement produces the same findings and changes nothing either
 * time, which is what makes it safe to put behind a button a user can press again.
 */

export type ReconciliationResult = {
  run: ReconciliationRunRow
  positions: PositionDifference[]
  cash: CashDifference[]
}

/** A statement of five hundred positions is five hundred rows; inserted in one statement, capped. */
const MAX_ITEMS = 1_000

function positionItem(
  difference: PositionDifference,
  runId: string,
  userId: string,
): Database["public"]["Tables"]["reconciliation_items"]["Insert"] {
  return {
    run_id: runId,
    user_id: userId,
    scope: "POSITIONS",
    status: difference.status,
    symbol: difference.symbol,
    market: difference.market,
    currency: difference.currency,
    transaction_id: null,
    /*
     * Both sides and the candidate causes, exactly as the domain produced them. A null stays a
     * null all the way into the column: "the statement reported no average cost" and "the average
     * cost is zero" are different facts and must not collapse into one on the way to storage.
     */
    detail: {
      brokerQuantity: difference.brokerQuantity,
      stocklyQuantity: difference.stocklyQuantity,
      quantityDifference: difference.quantityDifference,
      brokerAverageCost: difference.brokerAverageCost,
      stocklyAverageCost: difference.stocklyAverageCost,
      costDifferencePct: difference.costDifferencePct,
      causes: difference.causes,
    },
  }
}

function cashItem(
  difference: CashDifference,
  runId: string,
  userId: string,
): Database["public"]["Tables"]["reconciliation_items"]["Insert"] {
  return {
    run_id: runId,
    user_id: userId,
    scope: "CASH",
    status: difference.status,
    symbol: null,
    market: null,
    currency: difference.currency,
    transaction_id: null,
    detail: {
      brokerBalance: difference.brokerBalance,
      stocklyBalance: difference.stocklyBalance,
      difference: difference.difference,
      causes: difference.causes,
    },
  }
}

export async function runReconciliation(
  supabase: SupabaseClient<Database>,
  request: ReconciliationRequest,
  userId: string,
): Promise<ReconciliationResult> {
  /*
   * The run row is written first, as PROCESSING.
   *
   * A crash between here and the update below leaves a run visibly stuck rather than leaving no
   * trace that anything was attempted — and `stale-reconciliation` in the data-quality scan is what
   * surfaces it. A row written only on success cannot report a failure.
   */
  const { data: run, error: runError } = await supabase
    .from("reconciliation_runs")
    .insert({
      portfolio_id: request.portfolioId,
      user_id: userId,
      source_label: request.sourceLabel,
      period_start: request.periodStart,
      period_end: request.periodEnd,
      status: "PROCESSING",
    })
    .select("*")
    .single()

  if (runError) throw runError

  try {
    // The cached pass the page already used. A reconciliation costs no extra quote call.
    const analytics = await loadAnalytics(request.portfolioId)

    const positions =
      request.positions.length > 0
        ? reconcilePositions(request.positions, analytics.holdings)
        : []
    const cash =
      request.balances.length > 0 ? reconcileCash(request.balances, analytics.cashByCurrency) : []

    const summary = summarise(positions, cash)
    const items = [
      ...positions.map((d) => positionItem(d, run.id, userId)),
      ...cash.map((d) => cashItem(d, run.id, userId)),
    ].slice(0, MAX_ITEMS)

    if (items.length > 0) {
      const { error } = await supabase.from("reconciliation_items").insert(items)
      if (error) throw error
    }

    const { data: finished, error: updateError } = await supabase
      .from("reconciliation_runs")
      .update({
        status: statusFor(summary),
        summary: { ...summary },
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id)
      .select("*")
      .single()

    if (updateError) throw updateError

    // Counters only: no symbol, no balance, no portfolio figure.
    logger.info("reconciliation.completed", {
      runId: run.id,
      status: finished.status,
      positions: positions.length,
      positionDifferences: summary.positions.differences,
      cash: cash.length,
      cashDifferences: summary.cash.differences,
    })

    return { run: finished, positions, cash }
  } catch (error) {
    /*
     * A failure is recorded as one. An empty successful run and a run that could not be produced
     * look identical on a screen and mean opposite things — the constraint on the table refuses a
     * FAILED row with no reason for exactly that reason.
     */
    await supabase
      .from("reconciliation_runs")
      .update({
        status: "FAILED",
        error: "The comparison could not be completed.",
        completed_at: new Date().toISOString(),
      })
      .eq("id", run.id)

    logger.error("reconciliation.failed", { runId: run.id })
    throw error
  }
}

/** Counts a stored run's findings back into the summary shape, for the report page. */
export function summariseItems(items: readonly ReconciliationItemRow[]) {
  const of = (scope: ReconciliationItemRow["scope"]) => {
    const rows = items.filter((item) => item.scope === scope)
    return {
      total: rows.length,
      matched: rows.filter((item) => item.status === "MATCHED").length,
      differences: rows.filter((item) => item.status !== "MATCHED").length,
      unresolved: rows.filter((item) => item.status !== "MATCHED" && item.resolved_at === null).length,
    }
  }
  return { positions: of("POSITIONS"), cash: of("CASH"), transactions: of("TRANSACTIONS") }
}
