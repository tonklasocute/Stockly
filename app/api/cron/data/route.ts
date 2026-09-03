import { NextResponse } from "next/server"
import { isAuthorizedCronRequest } from "@/features/alerts/cron-auth"
import { recordJob, refreshMarketData } from "@/features/automation/refresh"
import { refreshFundamentals } from "@/features/automation/fundamentals-refresh"
import { serverEnv } from "@/lib/env.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { describeError, logger } from "@/lib/log"

/**
 * Scheduled data refresh: quotes and exchange rates, warmed so a user's first page load of the day
 * is not the request that pays for them.
 *
 * A second endpoint rather than more work inside `/api/cron/alerts` because the two have different
 * shapes: alerts run every five minutes and must stay inside a tight budget, while this is
 * once-daily housekeeping that touches every market. Both share the one secret and the one
 * constant-time check — a second scheduler with a second credential would be a second thing to
 * protect for no benefit.
 *
 * **It creates nothing.** No transaction, no holding, no user-owned row of any kind. It writes to a
 * provider cache and one history record, and running it twice does the same thing as running it
 * once: the caches are keyed by content and the history row is a new row either way.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers, serverEnv.cronSecret)) {
    // Deliberately terse: no hint about whether the secret is unset or merely wrong. An unset
    // secret means nobody gets in — a scheduled job must never become a public endpoint.
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Not authorized." } },
      { status: 401 },
    )
  }

  try {
    const supabase = createAdminClient()

    const summary = await recordJob(supabase, "data-refresh", async () => {
      const result = await refreshMarketData(supabase)
      return {
        processed: result.symbols + result.fxPairs,
        succeeded: result.quotesFetched + result.fxPairs,
        failed: result.errors.length,
        ...result,
      }
    })

    /*
     * Fundamentals ride on this job rather than getting a fourth endpoint and a fourth schedule.
     *
     * They change quarterly, so a daily refresh is already generous, and folding them in keeps one
     * secret, one schedule and one history row. It runs after the quotes and cannot fail them: a
     * fundamentals provider outage costs fundamentals alone.
     */
    const fundamentals = await recordJob(supabase, "fundamentals-refresh", async () => {
      const result = await refreshFundamentals(supabase)
      return {
        ...result,
        processed: result.instruments,
        succeeded: result.statementsWritten + result.eventsWritten,
        failed: result.failed,
      }
    }).catch((error: unknown) => {
      logger.warn("cron.fundamentals_failed", describeError(error))
      return null
    })

    // Counters only, and free of anything identifying.
    logger.info("cron.data", {
      symbols: summary.symbols,
      quotes: summary.quotesFetched,
      fxPairs: summary.fxPairs,
      errors: summary.errors.length,
      fundamentalInstruments: fundamentals?.instruments ?? 0,
      fundamentalStatements: fundamentals?.statementsWritten ?? 0,
      fundamentalEvents: fundamentals?.eventsWritten ?? 0,
    })
    return NextResponse.json({ success: true, data: summary })
  } catch (error) {
    logger.error("cron.data_failed", {
      message: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Data refresh failed." } },
      { status: 500 },
    )
  }
}

/** Vercel Cron issues GET; POST is accepted so an external scheduler can use either. */
export const POST = GET
