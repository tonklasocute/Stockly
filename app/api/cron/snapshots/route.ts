import { NextResponse } from "next/server"
import { isAuthorizedCronRequest } from "@/features/alerts/cron-auth"
import { recordJob } from "@/features/automation/refresh"
import { recordEndOfDaySnapshots } from "@/features/automation/snapshots"
import { serverEnv } from "@/lib/env.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { describeError, logger } from "@/lib/log"

/**
 * The end-of-day snapshot job.
 *
 * Its own endpoint rather than more work inside `/api/cron/data` because the two answer to
 * different clocks: the refresh warms caches for whoever loads a page next, while this has to run
 * *after a market closes* and stamp the row with that market's own trading date. Folding it into a
 * job scheduled for a different moment would mean one of the two ran at the wrong time.
 *
 * Shares the one secret and the one constant-time check, as `/api/cron/data` does — a third
 * credential would be a third thing to protect for no benefit.
 *
 * **It creates nothing a user owns and no transaction.** It writes one row per portfolio per
 * trading date, keyed so that running twice upserts rather than appends. Running it three times is
 * the same as running it once.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers, serverEnv.cronSecret)) {
    // Terse on purpose: no hint about whether the secret is unset or merely wrong.
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Not authorized." } },
      { status: 401 },
    )
  }

  try {
    const supabase = createAdminClient()

    const summary = await recordJob(supabase, "eod-snapshots", async () => {
      const result = await recordEndOfDaySnapshots(supabase, new Date())
      // Spread first, then the counters `recordJob` reads — `failed` appears in both shapes and
      // the job history's meaning is the one that must win.
      return {
        ...result,
        processed: result.portfolios,
        succeeded: result.written,
        failed: result.failed,
      }
    })

    // Counters and trading dates. Never a portfolio value.
    logger.info("cron.snapshots", {
      portfolios: summary.portfolios,
      written: summary.written,
      skipped: summary.skipped,
      failed: summary.failed,
    })
    return NextResponse.json({ success: true, data: summary })
  } catch (error) {
    logger.error("cron.snapshots_failed", describeError(error))
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "The snapshot job failed." } },
      { status: 500 },
    )
  }
}

export const POST = GET
