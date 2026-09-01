import "server-only"

/**
 * A fixed-window limiter held in module memory.
 *
 * Honest about what it is: on Vercel each serverless instance keeps its own counter, so the real
 * ceiling is `limit × instances`, and a cold start forgets everything. That makes it a brake on
 * accidental loops and casual abuse, not a security control.
 *
 * The controls that actually hold are elsewhere and do not depend on this: the cron endpoint is
 * guarded by a shared secret, alert creation by a hard per-user row cap enforced against the
 * database, and every read by RLS.
 *
 * `ponytail:` ceiling — move to Postgres or Upstash if a limit ever needs to be enforced rather
 * than merely encouraged.
 */
type Window = { count: number; resetAt: number }

const windows = new Map<string, Window>()

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number }

export function rateLimit(key: string, limit: number, windowSeconds: number): RateLimitResult {
  const now = Date.now()
  const existing = windows.get(key)

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
    // Opportunistic sweep so the map cannot grow without bound across a long-lived instance.
    if (windows.size > 5_000) {
      for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k)
    }
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 }
  }

  existing.count += 1
  const allowed = existing.count <= limit
  return {
    allowed,
    remaining: Math.max(0, limit - existing.count),
    retryAfterSeconds: allowed ? 0 : Math.ceil((existing.resetAt - now) / 1000),
  }
}

/** The most a single user may hold. A cap the database can enforce beats a counter that forgets. */
export const MAX_ALERTS_PER_USER = 100
