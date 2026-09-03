export type FundamentalErrorCode =
  | "FUNDAMENTALS_UNAVAILABLE"
  | "FUNDAMENTALS_RATE_LIMITED"
  | "FUNDAMENTALS_TIMEOUT"
  | "FUNDAMENTALS_NOT_CONFIGURED"
  | "FUNDAMENTALS_INVALID_RESPONSE"
  | "FUNDAMENTALS_NOT_COVERED"

/**
 * Everything the fundamentals layer throws.
 *
 * Same shape as `MarketDataError`, including the `retryable` flag that rides on the error rather
 * than being inferred from its code — a rejected key and a bad gateway are both "unavailable" to a
 * caller and only one is worth asking again.
 *
 * `FUNDAMENTALS_NOT_COVERED` is the one code with no equivalent in market data, and it exists to
 * keep an important distinction visible: **"this provider does not cover this market" is not
 * "this company has no financials".** The first is a gap in Stockly's configuration and the second
 * is a fact about the company; a UI that showed the same empty state for both would be lying about
 * one of them.
 */
export class FundamentalError extends Error {
  readonly retryable: boolean

  constructor(
    readonly code: FundamentalErrorCode,
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options)
    this.name = "FundamentalError"
    this.retryable = options?.retryable ?? false
  }

  static unavailable(cause?: unknown, { retryable = true } = {}) {
    return new FundamentalError(
      "FUNDAMENTALS_UNAVAILABLE",
      "Unable to load fundamental data. Please try again later.",
      { cause, retryable },
    )
  }

  static rateLimited(cause?: unknown) {
    return new FundamentalError(
      "FUNDAMENTALS_RATE_LIMITED",
      "Too many fundamental data requests right now.",
      { cause, retryable: true },
    )
  }

  static timeout(cause?: unknown) {
    return new FundamentalError(
      "FUNDAMENTALS_TIMEOUT",
      "Fundamental data took too long to respond.",
      { cause, retryable: true },
    )
  }

  static notConfigured() {
    return new FundamentalError(
      "FUNDAMENTALS_NOT_CONFIGURED",
      "Fundamental data is not configured for this deployment.",
    )
  }

  static invalidResponse(cause?: unknown) {
    return new FundamentalError(
      "FUNDAMENTALS_INVALID_RESPONSE",
      "Fundamental data returned something unexpected.",
      { cause },
    )
  }

  /** Not an outage: a statement about what this deployment's provider covers. */
  static notCovered(market: string) {
    return new FundamentalError(
      "FUNDAMENTALS_NOT_COVERED",
      `Stockly's fundamental data provider does not cover ${market}.`,
    )
  }
}

export function isFundamentalError(error: unknown): error is FundamentalError {
  return error instanceof FundamentalError
}
