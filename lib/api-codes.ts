/**
 * The API's error vocabulary, in a module with no server imports.
 *
 * Split out of `lib/api.ts` in phase 21 for one reason: `lib/api.ts` is `server-only`, and the
 * browser now needs to know these codes in order to translate them. A copy in the client bundle
 * would be two registries that drift; this is one registry that both sides import.
 *
 * The status code beside each name is the contract: adding a code means deciding what it means to
 * an HTTP client *and* adding its sentence to the `errors` namespace in both languages, which the completeness test
 * then requires in both languages.
 */
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
  RATE_LIMITED: 429,
  AI_DISABLED: 503,
  AI_NOT_CONFIGURED: 500,
  AI_UNAVAILABLE: 503,
  AI_RATE_LIMITED: 429,
  AI_TIMEOUT: 504,
  AI_INVALID_RESPONSE: 502,
  AI_QUOTA_EXCEEDED: 429,
  PAYLOAD_TOO_LARGE: 413,
} as const

export type ErrorCode = keyof typeof ERROR_CODES
