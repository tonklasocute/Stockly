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
  constructor(
    readonly code: MarketDataErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = "MarketDataError"
  }

  static unavailable(cause?: unknown) {
    return new MarketDataError(
      "MARKET_DATA_UNAVAILABLE",
      "Unable to load market data. Please try again later.",
      { cause },
    )
  }

  static rateLimited(cause?: unknown) {
    return new MarketDataError(
      "MARKET_DATA_RATE_LIMITED",
      "Too many market data requests right now. Prices will refresh shortly.",
      { cause },
    )
  }

  static timeout(cause?: unknown) {
    return new MarketDataError(
      "MARKET_DATA_TIMEOUT",
      "Market data took too long to respond. Please try again.",
      { cause },
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
