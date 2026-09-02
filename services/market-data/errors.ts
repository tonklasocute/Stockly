export type MarketDataErrorCode =
  | "MARKET_DATA_UNAVAILABLE"
  | "MARKET_DATA_RATE_LIMITED"
  | "MARKET_DATA_TIMEOUT"
  | "MARKET_DATA_NOT_CONFIGURED"
  | "MARKET_DATA_INVALID_RESPONSE"

/**
 * Everything the market-data layer throws. The message is written for a user; whatever the provider
 * actually said stays in `cause` and is logged, never returned.
 */
export class MarketDataError extends Error {
  /**
   * Whether trying again in a moment could plausibly give a different answer.
   *
   * Carried on the error rather than inferred from the code, because the code answers a different
   * question. An HTTP 401 and an HTTP 502 are both "unavailable" to a caller — the page degrades
   * identically — but only one of them is worth a second request. Same shape as `AIError`.
   */
  readonly retryable: boolean

  constructor(
    readonly code: MarketDataErrorCode,
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options)
    this.name = "MarketDataError"
    this.retryable = options?.retryable ?? false
  }

  /**
   * The provider could not answer. Retryable by default: a dropped connection or one unlucky 502
   * usually is. `retryable: false` marks the cases that are a statement about the request itself —
   * a rejected key, an endpoint that does not exist — where a second attempt only doubles the load
   * on a provider already refusing us.
   */
  static unavailable(cause?: unknown, { retryable = true } = {}) {
    return new MarketDataError(
      "MARKET_DATA_UNAVAILABLE",
      "Unable to load market data. Please try again later.",
      { cause, retryable },
    )
  }

  static rateLimited(cause?: unknown) {
    return new MarketDataError(
      "MARKET_DATA_RATE_LIMITED",
      "Too many market data requests right now. Prices will refresh shortly.",
      // Retried once, never more. The free tier's window is per-minute and another instance may
      // have been luckier; an unbounded retry on a 429 is how a rate limit becomes an outage.
      { cause, retryable: true },
    )
  }

  static timeout(cause?: unknown) {
    return new MarketDataError(
      "MARKET_DATA_TIMEOUT",
      "Market data took too long to respond. Please try again.",
      { cause, retryable: true },
    )
  }

  static notConfigured() {
    return new MarketDataError(
      "MARKET_DATA_NOT_CONFIGURED",
      "Market data is not configured. Set MARKET_DATA_API_KEY in .env.local.",
    )
  }

  static invalidResponse(cause?: unknown) {
    return new MarketDataError(
      "MARKET_DATA_INVALID_RESPONSE",
      "Market data returned something unexpected. Please try again later.",
      { cause },
    )
  }
}

export function isMarketDataError(error: unknown): error is MarketDataError {
  return error instanceof MarketDataError
}
