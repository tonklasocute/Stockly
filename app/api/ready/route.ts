import { NextResponse } from "next/server"
import { isSupabaseConfigured } from "@/lib/env"
import { logger } from "@/lib/log"
import { createClient } from "@/lib/supabase/server"
import { APP_VERSION } from "@/lib/version"

/**
 * Readiness. "Can this instance actually serve a request?"
 *
 * One cheap round trip to Postgres — a `head` count that RLS answers with zero rows for an
 * anonymous caller. What is being tested is that the connection works, not what it returns.
 *
 * The market-data provider and the model are **not** probed. Both are third parties Stockly is
 * designed to survive without: a quote outage falls back to cost basis and says so, and AI failing
 * costs the assistant and nothing else. Reporting the app as not-ready because somebody else's API
 * is slow would take the whole site down over a degradation it already handles.
 */
export const dynamic = "force-dynamic"

/**
 * The result is held briefly so an unauthenticated probe cannot be turned into a way to make the
 * database do work. Ten seconds is far shorter than any sensible probe interval and long enough
 * that a flood costs one query.
 */
const CACHE_MS = 10_000
let cached: { at: number; ready: boolean; latencyMs: number } | null = null

async function probe(): Promise<{ ready: boolean; latencyMs: number }> {
  const now = Date.now()
  if (cached && now - cached.at < CACHE_MS) {
    return { ready: cached.ready, latencyMs: cached.latencyMs }
  }

  const startedAt = Date.now()
  let ready = false
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("technical_snapshots")
      .select("symbol", { count: "exact", head: true })
      .limit(1)
    ready = !error
    if (error) logger.warn("ready.database", { code: error.code })
  } catch (error) {
    logger.error("ready.database", { message: error instanceof Error ? error.message : "unknown" })
  }

  const latencyMs = Date.now() - startedAt
  cached = { at: now, ready, latencyMs }
  return { ready, latencyMs }
}

export async function GET() {
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { status: "not_ready", reason: "configuration", version: APP_VERSION },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    )
  }

  const { ready, latencyMs } = await probe()
  return NextResponse.json(
    {
      status: ready ? "ready" : "not_ready",
      version: APP_VERSION,
      checks: { database: { ok: ready, latencyMs } },
      timestamp: new Date().toISOString(),
    },
    { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  )
}
