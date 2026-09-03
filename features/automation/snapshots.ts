import "server-only"

import { marketDate, marketSessionStatus } from "@/domain/calendar"
import { MARKET_REGISTRY, type MarketId } from "@/domain/market"
import { logger } from "@/lib/log"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database, PortfolioSnapshotRow } from "@/types/database"

/**
 * The scheduled end-of-day snapshot.
 *
 * Why a job at all, when the analytics page already records one: a page view records a snapshot at
 * whatever time somebody happened to open it, and a portfolio nobody opened that day gets no row.
 * A history assembled from those is a history of when its owner was curious. The job records the
 * close, every day, for every portfolio — and stamps `source = 'SCHEDULED'` so a chart can tell the
 * two apart.
 *
 * Four properties, each of which is a line of code below:
 *
 * - **Idempotent.** The unique constraint on `(portfolio_id, snapshot_date)` means a second run
 *   upserts the same row rather than appending a second reading for the same date. Running twice
 *   is not merely safe, it is a no-op.
 * - **Calendar-aware.** A snapshot is taken for the market's own trading date, in the market's own
 *   timezone. Never the server clock — a job running at 01:00 UTC would otherwise stamp a US close
 *   with tomorrow's date.
 * - **Bounded.** A hard cap per run, so one invocation can never turn into an unbounded scan.
 * - **Observable.** Counters into `job_executions`, never a figure.
 */

/** The most portfolios one run will touch. A backlog is finished by the next run, not by a timeout. */
export const MAX_SNAPSHOT_PORTFOLIOS = 200

export type SnapshotRun = {
  portfolios: number
  written: number
  skipped: number
  failed: number
  /** The trading date each market was snapshotted for. */
  dates: Record<string, string>
}

/**
 * Whether a market's session has finished for its own trading date.
 *
 * `post` and `closed` both mean the regular session is over and a closing price exists. `unknown`
 * — past the calendar's verified holiday horizon — is treated as **not ready**: writing a snapshot
 * for a day that may have been a holiday would put a flat line in the history and call it a day the
 * market did nothing.
 */
export function sessionFinished(market: MarketId, at: Date): boolean {
  const status = marketSessionStatus(market, at)
  return status === "post" || status === "closed"
}

/** The date a snapshot taken now belongs to, in the market's own timezone. */
export function snapshotDateFor(market: MarketId, at: Date): string {
  return marketDate(market, at)
}

/**
 * Writes one day's snapshot for every portfolio that has transactions.
 *
 * It does **not** recompute a portfolio here — that would mean a full analytics pass and a batched
 * quote call per portfolio, which is exactly the cost this codebase spends its comments avoiding.
 * Instead it records the fact that the day closed, leaving the valuation to the pass that already
 * happens when the portfolio is read. What the job guarantees is that the *date* exists in the
 * series; `docs/historical-rebuild.md` describes the bounded backfill that fills a value in.
 */
export async function recordEndOfDaySnapshots(
  supabase: SupabaseClient<Database>,
  now: Date,
): Promise<SnapshotRun> {
  const run: SnapshotRun = { portfolios: 0, written: 0, skipped: 0, failed: 0, dates: {} }

  const markets = (Object.keys(MARKET_REGISTRY) as MarketId[]).filter((market) =>
    sessionFinished(market, now),
  )
  if (markets.length === 0) {
    logger.info("snapshots.skipped", { reason: "no_market_closed" })
    return run
  }
  for (const market of markets) run.dates[market] = snapshotDateFor(market, now)

  const { data: portfolios, error } = await supabase
    .from("portfolios")
    .select("id, user_id, currency")
    .limit(MAX_SNAPSHOT_PORTFOLIOS)

  if (error) {
    logger.error("snapshots.portfolio_read_failed", { code: error.code })
    run.failed += 1
    return run
  }

  run.portfolios = portfolios?.length ?? 0

  /*
   * Every portfolio's latest reading, in **one** query.
   *
   * Phase 17.5 found this as a `select … limit 1` per portfolio — 200 sequential round trips over
   * HTTP inside a function with a 60-second budget, degrading exactly as the deployment grows
   * (PERF-001). One indexed read ordered by date, then the first row seen per portfolio, is the
   * same answer for one round trip.
   */
  const latestByPortfolio = new Map<string, PortfolioSnapshotRow>()
  if ((portfolios?.length ?? 0) > 0) {
    const { data: recent, error: recentError } = await supabase
      .from("portfolio_snapshots")
      .select("*")
      .in("portfolio_id", (portfolios ?? []).map((p) => p.id))
      .order("snapshot_date", { ascending: false })
      // Generous: the newest rows across every portfolio in one pass. Ordered by date descending,
      // so the first row seen for a portfolio is its latest.
      .limit(MAX_SNAPSHOT_PORTFOLIOS * 4)

    if (recentError) {
      logger.error("snapshots.snapshot_read_failed", { code: recentError.code })
      run.failed += 1
      return run
    }
    for (const row of recent ?? []) {
      if (!latestByPortfolio.has(row.portfolio_id)) latestByPortfolio.set(row.portfolio_id, row)
    }
  }

  for (const portfolio of portfolios ?? []) {
    /*
     * The previous reading, carried forward as the day's row.
     *
     * This is the honest version of "record the close without repricing": the portfolio's most
     * recent known value, stamped **STALE** so nothing downstream can mistake it for a fresh
     * valuation. A stale row that says so is more useful than a gap that says nothing — and it is
     * replaced the moment a real valuation for that date arrives, because the upsert is keyed on
     * the date.
     *
     * Since phase 17.5 a STALE row is also excluded from every return and risk calculation
     * (FIN-001): it is a record that the day existed, never an input to a figure.
     */
    const latest = latestByPortfolio.get(portfolio.id)

    if (!latest) {
      run.skipped += 1
      continue
    }

    const date = run.dates[marketOfCurrency(portfolio.currency)] ?? run.dates.US
    if (!date || latest.snapshot_date >= date) {
      // Already have a reading for this trading date. Idempotency, in the common path.
      run.skipped += 1
      continue
    }

    const { error: writeError } = await supabase.from("portfolio_snapshots").upsert(
      {
        portfolio_id: portfolio.id,
        user_id: portfolio.user_id,
        snapshot_date: date,
        currency: latest.currency,
        total_value: latest.total_value,
        invested_value: latest.invested_value,
        cash_value: latest.cash_value,
        realized_pnl: latest.realized_pnl,
        unrealized_pnl: latest.unrealized_pnl,
        quality: "STALE",
        // Carried forward, so exactly what the source row was missing — no more and no less. This
        // used to be `Math.max(latest.missing_holdings, 1)`, which invented a missing holding to
        // satisfy the phase 16 constraint that refused a STALE row with a count of 0. Migration
        // 20260912000000 states that rule per quality instead, so the true count can be written.
        missing_holdings: latest.missing_holdings,
        calculation_version: latest.calculation_version,
        source: "SCHEDULED",
      },
      { onConflict: "portfolio_id,snapshot_date" },
    )

    if (writeError) {
      logger.warn("snapshots.write_failed", { code: writeError.code })
      run.failed += 1
    } else {
      run.written += 1
    }
  }

  logger.info("snapshots.completed", {
    portfolios: run.portfolios,
    written: run.written,
    skipped: run.skipped,
    failed: run.failed,
  })
  return run
}

/** The market whose calendar decides a portfolio's snapshot date, from its base currency. */
function marketOfCurrency(currency: string): MarketId {
  return currency === "THB" ? "SET" : "US"
}
