import type { ApiResponse } from "./api"
import type { ErrorCode, ErrorDetail } from "./api-codes"

/**
 * A failure the server described, with its code intact.
 *
 * Phase 21's rule: **the server sends a code, the client decides the words.** The envelope has
 * always carried a stable `code` alongside an English `message`; before this the client threw away
 * the code and displayed the message, which made every error message in the application
 * untranslatable no matter what the locale said.
 *
 * `message` is kept and is still the fallback — it is what a developer sees in a console, what a
 * bug report quotes, and what renders if a new code reaches an older client. It is not the primary
 * text any more. Nothing about the wire format changed, so no endpoint and no other consumer had
 * to move.
 */
export class ApiClientError extends Error {
  readonly code: ErrorCode
  /** The specific reason, when the status code alone does not identify it. */
  readonly detail?: ErrorDetail
  readonly details?: Record<string, string[]>
  /** Echoed by `guarded()`, so a user can quote one string and it can be found in the logs. */
  readonly requestId?: string

  constructor(
    code: ErrorCode,
    message: string,
    options?: { detail?: ErrorDetail; details?: Record<string, string[]>; requestId?: string },
  ) {
    super(message)
    this.name = "ApiClientError"
    this.code = code
    this.detail = options?.detail
    this.details = options?.details
    this.requestId = options?.requestId
  }
}

export function isApiClientError(error: unknown): error is ApiClientError {
  return error instanceof ApiClientError
}

/**
 * Client-side fetch that unwraps the envelope and throws something a form can display.
 *
 * Lives apart from lib/api.ts so a client component never pulls the server helpers (and with them
 * next/headers) into the browser bundle.
 */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  const payload = (await response.json().catch(() => null)) as ApiResponse<T> | null

  // An unreadable body is not a coded failure — it is a proxy, an outage or an offline device.
  // `INTERNAL_ERROR` is the honest code for "the server did not tell us"; the network case is
  // distinguished by the fetch itself rejecting, before this line.
  if (!payload) {
    throw new ApiClientError("INTERNAL_ERROR", "The server returned an unreadable response.")
  }
  if (!payload.success) {
    throw new ApiClientError(payload.error.code, payload.error.message, {
      detail: payload.error.detail,
      details: payload.error.details,
      requestId: payload.requestId,
    })
  }
  return payload.data
}
