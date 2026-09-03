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

/**
 * The **detail** vocabulary: a specific reason, on top of a status code.
 *
 * `CONFLICT` tells an HTTP client what to do; it does not tell a person what happened. "You already
 * have a portfolio with that name" and "another open thesis already covers that instrument" are
 * both conflicts, and a user needs the difference. Before phase 21 that difference lived in the
 * English `message`, which made it untranslatable.
 *
 * So a detail is a code too. The status code stays the contract for machines, the detail is the
 * contract for words, and `errors.detail.<key>` supplies them in every language — required in both
 * by the completeness test.
 *
 * Note where three keys became one: "Portfolio not found", "That portfolio does not exist" and
 * "That portfolio could not be found" were three sentences for one situation. A reader was being
 * told the same thing three ways depending on which route they hit.
 */
export const ERROR_DETAILS = [
  // Conflicts — something with that identity already exists.
  "duplicateAlert",
  "duplicateGoalType",
  "duplicatePortfolioName",
  "duplicateScenarioName",
  "duplicateScreenName",
  "duplicateSellReview",
  "duplicateSlug",
  "duplicateTagName",
  "duplicateThesis",
  "duplicateViewName",

  // Not found.
  "portfolioMissing",
  "shareLinkMissing",
  "snapshotMissing",
  "tagMissing",
  "viewMissing",
  "benchmarkMissing",

  // Validation — the request could not be accepted as sent.
  "portfolioRequired",
  "symbolRequired",
  "symbolInvalid",
  "fileRequired",
  "fileUnreadable",
  "reasonRequired",
  "entityOrPortfolioRequired",
  "filterInvalid",
  "categoryInvalid",
  "feedInvalid",
  "periodInvalid",
  "sortInvalid",
  "settingsIncompatible",
  "transferInvalid",
  "goalCurrencyRule",
  // A database check constraint refused the row. Named per table so the message can say which.
  "dataRuleAdjustment",
  "dataRuleAlert",
  "dataRuleCash",
  "dataRuleChange",
  "dataRuleDividend",
  "dataRuleGoal",
  "dataRuleJournal",
  "dataRuleScenario",
  "dataRuleThesis",
  "dataRuleTransaction",
] as const

export type ErrorDetail = (typeof ERROR_DETAILS)[number]
