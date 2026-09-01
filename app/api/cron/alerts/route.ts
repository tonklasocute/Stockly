import { NextResponse } from "next/server"
import { isAuthorizedCronRequest } from "@/features/alerts/cron-auth"
import { evaluateAllAlerts } from "@/features/alerts/evaluate"
import { serverEnv } from "@/lib/env.server"
import { createAdminClient } from "@/lib/supabase/admin"

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
    const summary = await evaluateAllAlerts(createAdminClient())
    // Structured, and free of anything identifying: counters only, no user ids or symbols.
    console.info("[cron:alerts]", JSON.stringify(summary))
    return NextResponse.json({ success: true, data: summary })
  } catch (error) {
    console.error("[cron:alerts] failed", error)
    return NextResponse.json(
      { success: false, error: { code: "INTERNAL_ERROR", message: "Alert evaluation failed." } },
      { status: 500 },
    )
  }
}

/** Vercel Cron issues GET; POST is accepted so an external scheduler can use either. */
export const POST = GET
