export type AIErrorCode =
  | "AI_DISABLED"
  | "AI_NOT_CONFIGURED"
  | "AI_UNAVAILABLE"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_INVALID_RESPONSE"
  | "AI_QUOTA_EXCEEDED"

/**
 * Everything the AI layer throws.
 *
 * The message is written for a user to read; whatever the provider actually said stays in `cause`
 * and is logged server-side. A provider's error text can echo the prompt back, so returning it
 * would be both confusing and a small data leak.
 */
export class AIError extends Error {
  constructor(
    readonly code: AIErrorCode,
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, options)
    this.name = "AIError"
    this.retryable = options?.retryable ?? false
  }

  readonly retryable: boolean

  static disabled() {
    return new AIError("AI_DISABLED", "Stockly AI is turned off for this deployment.")
  }

  static notConfigured() {
    return new AIError(
      "AI_NOT_CONFIGURED",
      "Stockly AI is not configured. Set AI_PROVIDER and AI_API_KEY in .env.local.",
    )
  }

  static unavailable(cause?: unknown) {
    return new AIError("AI_UNAVAILABLE", "Stockly AI is temporarily unavailable. Please try again later.", {
      cause,
      retryable: true,
    })
  }

  static rateLimited(cause?: unknown) {
    return new AIError("AI_RATE_LIMITED", "Stockly AI is busy right now. Please try again in a moment.", {
      cause,
      retryable: true,
    })
  }

  static timeout(cause?: unknown) {
    return new AIError("AI_TIMEOUT", "Stockly AI took too long to respond. Please try again.", {
      cause,
      retryable: true,
    })
  }

  static invalidResponse(cause?: unknown) {
    return new AIError(
      "AI_INVALID_RESPONSE",
      "Stockly AI returned something unreadable. Please try again.",
      { cause },
    )
  }

  static quotaExceeded(limit: number) {
    return new AIError(
      "AI_QUOTA_EXCEEDED",
      `You have used all ${limit} AI requests for today. The limit resets 24 hours after each request.`,
    )
  }
}

export function isAIError(error: unknown): error is AIError {
  return error instanceof AIError
}
