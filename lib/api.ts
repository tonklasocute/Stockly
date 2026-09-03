import "server-only"

import { headers } from "next/headers"
import { NextResponse } from "next/server"
import { ZodError, type ZodType } from "zod"
import { isSupabaseConfigured } from "@/lib/env"
import { describeError, logger, PATHNAME_HEADER, REQUEST_ID_HEADER, resolveRequestId } from "@/lib/log"
import { rateLimit } from "@/lib/rate-limit"
import { isAIError } from "@/services/ai/errors"
import { isMarketDataError } from "@/services/market-data/errors"
import { ERROR_CODES, type ErrorCode, type ErrorDetail } from "./api-codes"
import { getUser } from "@/lib/supabase/server"

/*
 * The error vocabulary now lives in `lib/api-codes.ts`, which has no server imports, so the
 * browser can translate a code without pulling `next/headers` into the bundle. Re-exported here so
 * every existing `from "@/lib/api"` keeps working.
 */
export { ERROR_CODES, type ErrorCode } from "./api-codes"

/**
 * The largest request body any endpoint accepts.
 *
 * App Router route handlers have no default body limit — `await request.json()` will happily parse
 * whatever arrives — so this is the only thing standing between a handler and a 200MB upload. It is
 * generous for the biggest legitimate body in the app (a screen definition, or an AI question
 * capped at 1,000 characters) and small enough that abuse costs the attacker more than the server.
 */
export const MAX_REQUEST_BYTES = 64 * 1024

/**
 * The one endpoint family that legitimately needs more.
 *
 * A five-hundred-row broker export is a few hundred kilobytes of grid, and refusing it would make
 * import useless. Raised deliberately, applied only where it is passed, and still bounded — the
 * import schemas cap the rows, the columns and each cell on top of this.
 */
export const MAX_IMPORT_REQUEST_BYTES = 2 * 1024 * 1024


export type ApiSuccess<T> = { success: true; data: T }
export type ApiFailure = {
  success: false
  error: {
    code: ErrorCode
    /** English, for logs and for a developer. The client translates `detail` or `code`. */
    message: string
    /** A specific reason the client can put words to. */
    detail?: ErrorDetail
    details?: Record<string, string[]>
  }
  /** Echoed so a user can quote it in a bug report and it can be found in the logs. */
  requestId?: string
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

/**
 * Every API response carries `private, no-store`.
 *
 * Belt and braces rather than a fix for a known bug: Vercel does not edge-cache a dynamic route
 * handler, and every handler in this app is dynamic. But *every* endpoint here is authenticated and
 * user-specific, and the failure mode if that ever stops being true — one user's holdings served to
 * the next from a shared cache — is the worst bug this application could have. One header removes
 * the question.
 */
const NO_STORE = { "Cache-Control": "private, no-store" } as const

export function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ success: true, data }, { status, headers: NO_STORE })
}

export function fail(
  code: ErrorCode,
  message: string,
  details?: Record<string, string[]>,
  requestId?: string,
  detail?: ErrorDetail,
) {
  return NextResponse.json<ApiFailure>(
    {
      success: false,
      error: {
        code,
        message,
        ...(detail ? { detail } : {}),
        ...(details ? { details } : {}),
      },
      ...(requestId ? { requestId } : {}),
    },
    {
      status: ERROR_CODES[code],
      headers: { ...NO_STORE, ...(requestId ? { [REQUEST_ID_HEADER]: requestId } : {}) },
    },
  )
}

/** Zod issues keyed by field, for inline form errors. */
function fieldErrors(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_"
    ;(out[key] ??= []).push(issue.message)
  }
  return out
}

/**
 * `headers()` throws synchronously when there is no request scope — a unit test, or a call from
 * somewhere that is not a request. The wrapper still has a job to do in that case (mapping errors
 * to the envelope), so a missing scope costs a request id rather than the whole response.
 */
async function requestHeadersOrNull(): Promise<Headers | null> {
  try {
    return await headers()
  } catch {
    return null
  }
}

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    /**
     * The English sentence, for a log and for a developer. **Never shown to a user** since phase
     * 21 — the client renders `detail` or `code` instead, in the reader's own language.
     */
    message: string,
    /** Which specific reason this is, when the status code alone does not say. */
    readonly detail?: ErrorDetail,
  ) {
    super(message)
  }
}

/**
 * The single entry point for every route handler.
 *
 * Resolves the user, times the request, logs it structurally, and turns anything thrown into the
 * shared envelope. Postgres and provider messages never reach the client — they are logged against
 * the request id instead, which is what the user is shown and what a support conversation quotes.
 */
export async function guarded(
  fn: (userId: string) => Promise<Response>,
): Promise<Response> {
  const startedAt = Date.now()
  const requestHeaders = await requestHeadersOrNull()
  const requestId = resolveRequestId(requestHeaders?.get(REQUEST_ID_HEADER))
  const route = requestHeaders?.get(PATHNAME_HEADER) ?? undefined

  const finish = (response: Response, level: "info" | "warn" | "error" = "info") => {
    response.headers.set(REQUEST_ID_HEADER, requestId)
    logger[level]("api.request", {
      requestId,
      route,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    })
    return response
  }

  try {
    // Without credentials getUser() throws, which would surface as a meaningless 500. Checked
    // inside the try so every path out of this function goes through the error mapping below.
    if (!isSupabaseConfigured()) {
      return finish(
        fail("INTERNAL_ERROR", "Supabase is not configured. Fill in .env.local and restart.", undefined, requestId),
        "error",
      )
    }

    const user = await getUser()
    if (!user) {
      return finish(fail("UNAUTHENTICATED", "You must be signed in.", undefined, requestId), "warn")
    }
    return finish(await fn(user.id))
  } catch (error) {
    if (error instanceof ValidationError) {
      return finish(fail(error.code, error.message, error.details, requestId), "warn")
    }
    if (error instanceof ApiError) {
      return finish(fail(error.code, error.message, undefined, requestId, error.detail), "warn")
    }
    // The message is already written for a user; the provider detail stays in `cause`.
    if (isMarketDataError(error)) {
      logger.error("market-data.error", { requestId, route, code: error.code, cause: String(error.cause ?? "") })
      return finish(fail(error.code, error.message, undefined, requestId), "error")
    }
    // Same rule for the AI layer: the sentence is written for a user, and whatever the provider
    // actually said stays in the log. A provider's error text can echo the prompt back.
    if (isAIError(error)) {
      logger.error("ai.error", { requestId, route, code: error.code })
      return finish(fail(error.code, error.message, undefined, requestId), "error")
    }
    /*
     * Never the stack, never the Postgres `details` or `hint`, never the SQL. The id is the link
     * between what the user saw and what is in the log.
     *
     * `describeError` rather than an inline ternary because supabase-js throws a **plain object**,
     * not an Error — the previous `String(error)` produced `[object Object]` and this branch, the
     * one that matters most, logged nothing usable. It also refuses `details` and `hint`, which on
     * a unique violation quote the values of the conflicting row.
     */
    logger.error("api.error", { requestId, route, ...describeError(error) })
    return finish(
      fail("INTERNAL_ERROR", "Something went wrong. Please try again.", undefined, requestId),
      "error",
    )
  }
}

/**
 * Applies a rate limit, throwing the shared error shape when it trips. Keyed per user so one
 * account cannot exhaust another's budget.
 */
export function enforceRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
): void {
  const result = rateLimit(key, limit, windowSeconds)
  if (!result.allowed) {
    throw new ApiError(
      "RATE_LIMITED",
      `Too many requests. Try again in ${result.retryAfterSeconds} seconds.`,
    )
  }
}

/**
 * Parses a request body, throwing an ApiError the wrapper renders. Never trusts the client.
 *
 * The size check comes first and is done twice: the declared `Content-Length` is rejected outright,
 * and the body is then read as text and measured, because a chunked request declares no length at
 * all. Only then is it handed to `JSON.parse` — parsing is where an oversized body actually costs
 * memory, so checking afterwards would be checking too late.
 */
export async function parseBody<T>(
  request: Request,
  schema: ZodType<T>,
  { maxBytes = MAX_REQUEST_BYTES }: { maxBytes?: number } = {},
): Promise<T> {
  const declared = Number(request.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "That request is too large.")
  }

  const raw = await request.text().catch(() => "")
  // Bytes, not characters: a body of multi-byte characters is bigger than its length suggests.
  if (new TextEncoder().encode(raw).length > maxBytes) {
    throw new ApiError("PAYLOAD_TOO_LARGE", "That request is too large.")
  }

  let body: unknown = null
  try {
    body = raw ? JSON.parse(raw) : null
  } catch {
    throw new ValidationError("Invalid request data.", { _: ["The request body is not valid JSON."] })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    throw new ValidationError("Invalid request data.", fieldErrors(parsed.error))
  }
  return parsed.data
}

export class ValidationError extends ApiError {
  constructor(
    message: string,
    readonly details: Record<string, string[]>,
  ) {
    super("VALIDATION_ERROR", message)
  }
}
