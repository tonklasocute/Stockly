/**
 * Structured logging.
 *
 * One line, one JSON object, so a log platform can filter on a field instead of on a regex against
 * English prose. Deliberately built on `console` rather than a logging library: Vercel captures
 * stdout, a library would add a dependency, a transport and a flush problem in a serverless
 * function that may be frozen mid-write, and none of that buys anything here.
 *
 * `ponytail:` ceiling — swap the `emit` function for a real transport if logs ever need to go
 * somewhere Vercel does not already send them. Every call site already passes structured fields.
 */

export type LogLevel = "debug" | "info" | "warn" | "error"

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/**
 * Production defaults to `info`: a debug line per request costs money at scale and, worse, tempts
 * whoever added it to include the payload that made it interesting.
 */
function threshold(): number {
  const configured = process.env.LOG_LEVEL as LogLevel | undefined
  if (configured && configured in SEVERITY) return SEVERITY[configured]
  return process.env.NODE_ENV === "production" ? SEVERITY.info : SEVERITY.debug
}

/**
 * Field names that must never carry a value into a log line, whoever passes them.
 *
 * A denylist is the weaker design — an allowlist cannot be bypassed by a new field name — but an
 * allowlist here would mean enumerating every field every call site might ever want, and the ones
 * that actually matter are a short, stable list. The stronger guarantee lives at the call sites:
 * nothing in this codebase passes a prompt, an answer or a key to a logger, and a test asserts it
 * for the AI feature, which is where the temptation is greatest.
 */
const REDACTED_KEYS =
  /^(?:.*(?:password|passwd|secret|token|apikey|api_key|authorization|cookie|credential|session).*|key)$/i

/** Values that look like a credential regardless of the field they arrived in. */
const SECRET_SHAPED = /\b(?:sk-[A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/

export type LogFields = Record<string, string | number | boolean | null | undefined>

/**
 * What can safely be said about a thrown value.
 *
 * The reason this exists: `String(error)` on a Supabase error yields `[object Object]`, so the one
 * place that most needs detail — the catch-all in `guarded()` — was logging nothing useful. And the
 * obvious fix, spreading the error into the fields, is worse: a Postgres error carries `details`
 * and `hint`, and on a unique violation those contain **the values of the conflicting row**. That
 * is a portfolio's data in a log line.
 *
 * So this takes the three fields that identify a failure and never the ones that quote the data:
 * a name, a code, and a message that is the library's own sentence.
 */
export function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return {
      name: error.name,
      message: error.message,
      code: typeof code === "string" || typeof code === "number" ? code : undefined,
    }
  }
  if (error !== null && typeof error === "object") {
    // The shape supabase-js throws: a plain object, not an Error.
    const candidate = error as { code?: unknown; message?: unknown; name?: unknown }
    return {
      name: typeof candidate.name === "string" ? candidate.name : "object",
      code: typeof candidate.code === "string" ? candidate.code : undefined,
      // Deliberately not `details` or `hint`: those quote the row that failed.
      message: typeof candidate.message === "string" ? candidate.message : undefined,
    }
  }
  return { name: typeof error, message: String(error).slice(0, 200) }
}

function sanitize(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (REDACTED_KEYS.test(key)) {
      out[key] = "[redacted]"
      continue
    }
    out[key] = typeof value === "string" && SECRET_SHAPED.test(value) ? "[redacted]" : value
  }
  return out
}

/**
 * `event` is a stable dotted name — `api.request`, `ai.request`, `market-data.fetch` — so a
 * dashboard can group by it. The human-readable part belongs in the fields, not in the name.
 */
export function log(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (SEVERITY[level] < threshold()) return

  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "stockly",
    event,
    ...sanitize(fields),
  })

  // console.error goes to stderr, which is what Vercel and most platforms treat as an error signal.
  if (level === "error") console.error(line)
  else if (level === "warn") console.warn(line)
  else console.info(line)
}

export const logger = {
  debug: (event: string, fields?: LogFields) => log("debug", event, fields),
  info: (event: string, fields?: LogFields) => log("info", event, fields),
  warn: (event: string, fields?: LogFields) => log("warn", event, fields),
  error: (event: string, fields?: LogFields) => log("error", event, fields),
}

/**
 * The header the middleware stamps on every request, echoed back on every response.
 *
 * It is what makes a user's "it broke at 3pm" actionable: they read the id off the error card, and
 * it appears on the request line, the error line and any provider call the request made.
 */
export const REQUEST_ID_HEADER = "x-request-id"
export const PATHNAME_HEADER = "x-pathname"
/** The per-request CSP nonce, forwarded so a Server Component can hand it to a client library. */
export const NONCE_HEADER = "x-nonce"

/** Trusts an upstream id when one exists (Vercel sets its own), so a trace is not broken in two. */
export function resolveRequestId(incoming: string | null | undefined): string {
  const candidate = incoming?.trim()
  // Bounded and character-restricted: an id ends up in a response header and in log lines, and
  // neither should be somewhere a client can inject a newline.
  if (candidate && /^[A-Za-z0-9_:.-]{8,128}$/.test(candidate)) return candidate
  return crypto.randomUUID()
}
