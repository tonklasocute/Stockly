import "server-only"

import { NextResponse } from "next/server"
import { ZodError, type ZodType } from "zod"
import { isSupabaseConfigured } from "@/lib/env"
import { isMarketDataError } from "@/services/market-data/errors"
import { getUser } from "@/lib/supabase/server"

export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  MARKET_DATA_UNAVAILABLE: 503,
  MARKET_DATA_RATE_LIMITED: 429,
  MARKET_DATA_TIMEOUT: 504,
  MARKET_DATA_NOT_CONFIGURED: 500,
  MARKET_DATA_INVALID_RESPONSE: 502,
} as const

export type ErrorCode = keyof typeof ERROR_CODES

export type ApiSuccess<T> = { success: true; data: T }
export type ApiFailure = {
  success: false
  error: { code: ErrorCode; message: string; details?: Record<string, string[]> }
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

export function ok<T>(data: T, status = 200) {
  return NextResponse.json<ApiSuccess<T>>({ success: true, data }, { status })
}

export function fail(code: ErrorCode, message: string, details?: Record<string, string[]>) {
  return NextResponse.json<ApiFailure>(
    { success: false, error: { code, message, ...(details ? { details } : {}) } },
    { status: ERROR_CODES[code] },
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

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Resolves the user and turns thrown errors into the standard shape. Postgres and provider
 * messages never reach the client — they are logged instead.
 */
export async function guarded(
  fn: (userId: string) => Promise<NextResponse>,
): Promise<NextResponse> {
  // Without credentials getUser() throws, which would surface as a meaningless 500.
  if (!isSupabaseConfigured()) {
    return fail("INTERNAL_ERROR", "Supabase is not configured. Fill in .env.local and restart.")
  }

  try {
    const user = await getUser()
    if (!user) return fail("UNAUTHENTICATED", "You must be signed in.")
    return await fn(user.id)
  } catch (error) {
    if (error instanceof ValidationError) return fail(error.code, error.message, error.details)
    if (error instanceof ApiError) return fail(error.code, error.message)
    // The message is already written for a user; the provider detail stays in `cause`.
    if (isMarketDataError(error)) {
      console.error("[api] market data", error.code, error.cause)
      return fail(error.code, error.message)
    }
    console.error("[api]", error)
    return fail("INTERNAL_ERROR", "Something went wrong. Please try again.")
  }
}

/** Parses a request body, throwing an ApiError the wrapper renders. Never trusts the client. */
export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await request.json().catch(() => null))
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
