import { NextResponse } from "next/server"
import { isAuthorizedCronRequest } from "@/features/alerts/cron-auth"
import { evaluateAllAlerts } from "@/features/alerts/evaluate"
import { sweepExpiredAIData } from "@/features/ai/queries"
import { refreshSnapshots } from "@/features/technical/snapshots"
import { serverEnv } from "@/lib/env.server"
import { createAdminClient } from "@/lib/supabase/admin"
import { describeError, logger } from "@/lib/log"

/**
 * Scheduled alert evaluation.
 *
 * Authentication is a shared secret, accepted from either the `Authorization: Bearer` header that
 * Vercel Cron sends or an `x-cron-secret` header for an external scheduler. Compared in constant
 * time so the endpoint cannot be probed a byte at a time.
 *
 * There is no user session here: the job reads alerts belonging to everyone, so it runs under the
 * service-role key. That is the one place in the app where RLS is bypassed, and it is reachable
 * only behind this check.
 */
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers, serverEnv.cronSecret)) {
    // Deliberately terse: no hint about whether the secret is unset or merely wrong.
    return NextResponse.json(
      { success: false, error: { code: "UNAUTHENTICATED", message: "Not authorized." } },
      { status: 401 },
    )
  }

  try {
    const supabase = createAdminClient()

    // Snapshots first: technical alerts read what this refresh writes, and the screener reads it
    // too. Budgeted so the whole run stays inside the function's time limit and the provider's
    // per-minute allowance.
    const technical = await refreshSnapshots(supabase, 12)
    const summary = await evaluateAllAlerts(supabase)

    // Retention. Two indexed deletes that almost always match nothing, riding a job that already
    // holds the only service-role credential in the app — rather than a second scheduler, a second
    // secret and a second endpoint to protect.
    const retention = await sweepExpiredAIData(supabase).catch((error: unknown) => {
      logger.error("cron.alerts_retention_failed", describeError(error))
      return null
    })

    /*
     * Counters only — no user id and no symbol — and **flat**, because `LogFields` accepts no
     * nested object. That restriction is deliberate rather than an inconvenience: a nested value is
     * how a whole provider payload or a row ends up in a log line by accident.
     */
    logger.info("cron.alerts", {
      ...summary,
      snapshotSymbols: technical.symbols,
      snapshotsComputed: technical.computed,
      snapshotsFailed: technical.failed,
      snapshotDurationMs: technical.durationMs,
      retentionConversations: retention?.conversations ?? null,
      retentionUsage: retention?.usage ?? null,
    })
    return NextResponse.json({ success: true, data: { ...summary, technical, retention } })
  } catch (error) {
    logger.error("cron.alerts_failed", describeError(error))
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Alert evaluation failed." } },
      { status: 500 },
    )
  }
}

/** Vercel Cron issues GET; POST is accepted so an external scheduler can use either. */
export const POST = GET
