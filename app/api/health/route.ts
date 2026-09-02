import { NextResponse } from "next/server"
import { APP_VERSION } from "@/lib/version"

/**
 * Liveness. "Is this function running?" — nothing more.
 *
 * It touches no database, no market-data provider and no model. A health check that queries the
 * database is a health check that reports the application as down during a database blip, which is
 * how a load balancer takes a recoverable incident and turns it into an outage. Readiness — "can it
 * serve traffic?" — is a separate probe at /api/ready.
 *
 * Unauthenticated by necessity, so it deliberately discloses nothing: a version and a timestamp.
 * Not which provider is configured, not whether AI is on, not an environment name.
 */
export const dynamic = "force-dynamic"

export function GET() {
  return NextResponse.json(
    { status: "ok", version: APP_VERSION, timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  )
}
