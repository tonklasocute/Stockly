import type { Candle } from "./indicators"

/**
 * The pure half of Stockly AI: intent, symbols, safety vocabulary, data completeness and the
 * history summary that keeps a prompt small.
 *
 * No provider, no database, no clock, no framework — so every rule here is unit-testable without
 * spending a token. That matters more for AI than for anything else in the app: the parts that
 * must not drift (what the model is allowed to say, what data it is told about) are exactly the
 * parts that are expensive to check by hand.
 *
 * See docs/AI.md.
 */

// ---------------------------------------------------------------- intent

export const AI_INTENTS = [
  "STOCK_ANALYSIS",
  "STOCK_COMPARISON",
  "TECHNICAL_EXPLANATION",
  "PORTFOLIO_ANALYSIS",
  "WATCHLIST_ANALYSIS",
  "SCREENER_EXPLANATION",
  "MARKET_SUMMARY",
  "INDICATOR_EXPLANATION",
  "GENERAL_RESEARCH",
] as const

export type AIIntent = (typeof AI_INTENTS)[number]

/*
 * The words for this enum live in the `enums` namespace, keyed by the same values, in every
 * language Stockly ships. A `Record<Enum, string>` of English here would be the copy the other
 * languages drift away from, and this module is the one that must hold no prose at all.
 */

/**
 * Which indicators a question is asking about. Used both to route to an explanation and to decide
 * what has to be retrieved — asking about RSI should not fetch a whole portfolio.
 */
export const INDICATOR_TERMS = [
  "rsi",
  "macd",
  "adx",
  "ema",
  "sma",
  "atr",
  "bollinger",
  "relative volume",
  "moving average",
  "technical score",
  "golden cross",
  "death cross",
] as const

/**
 * Intent detection, by rule.
 *
 * Deliberately not an LLM call. Routing decides *what data to retrieve*, and paying a round trip
 * plus a token bill to learn that "analyze my portfolio" is about the portfolio would be absurd —
 * it would also make the retrieval step non-deterministic, which is the one thing grounding cannot
 * afford. When nothing matches, the answer is GENERAL_RESEARCH rather than a guess.
 *
 * Order matters: the most specific phrasing wins, so "why is NVDA's technical score 78" is a
 * technical explanation rather than a plain analysis.
 */
export function detectIntent(question: string, symbolCount = 0): AIIntent {
  const text = question.toLowerCase()
  const has = (...terms: string[]) => terms.some((t) => text.includes(t))

  if (has("screener", "screen", "passed", "why did", "filter") && has("screen", "screener", "filter")) {
    return "SCREENER_EXPLANATION"
  }
  if (has("watchlist", "watch list")) return "WATCHLIST_ANALYSIS"
  if (has("my portfolio", "my holdings", "my positions", "portfolio")) return "PORTFOLIO_ANALYSIS"
  if (has("compare", "versus", " vs ", " vs. ") || symbolCount >= 2) return "STOCK_COMPARISON"

  // "Why is the technical score 78" is about this stock's score; "what is RSI" is about the
  // indicator itself. The difference is whether a symbol is in play.
  if (has("technical score", "score breakdown", "why is the score")) return "TECHNICAL_EXPLANATION"
  const mentionsIndicator = INDICATOR_TERMS.some((term) => text.includes(term))
  if (mentionsIndicator && symbolCount > 0) return "TECHNICAL_EXPLANATION"
  if (mentionsIndicator) return "INDICATOR_EXPLANATION"

  if (has("market", "s&p", "nasdaq", "indices", "breadth") && symbolCount === 0) {
    return "MARKET_SUMMARY"
  }
  if (symbolCount > 0) return "STOCK_ANALYSIS"
  return "GENERAL_RESEARCH"
}

// ---------------------------------------------------------------- symbols

/**
 * Common English words that are also listed tickers. Without this, "Is IT a good sector?" resolves
 * to the ticker IT and the assistant answers about the wrong thing entirely.
 *
 * They are only excluded when the user did not write them as a ticker — `$IT` still resolves.
 */
const TICKER_LOOKALIKES = new Set([
  "A", "ALL", "AN", "AND", "ANY", "ARE", "AS", "AT", "BE", "BEST", "BUT", "BY", "CAN", "DD", "DO",
  "FOR", "GO", "HAS", "HE", "HOW", "IF", "IN", "IS", "IT", "ITS", "LOW", "ME", "MY", "NO", "NOW",
  "OF", "ON", "OR", "OUT", "SO", "THE", "TO", "UP", "US", "WE", "WHY", "AI",
])

/** How many symbols one request may pull data for. A cap on cost as much as on prompt size. */
export const MAX_SYMBOLS_PER_REQUEST = 5

export type SymbolExtraction = {
  /** Symbols that exist in the supported universe. */
  symbols: string[]
  /** Ticker-shaped words that are not in the universe — reported to the user, never invented. */
  unknown: string[]
}

/**
 * Pulls tickers out of a question and **validates every one against the supported universe**.
 *
 * A symbol the deployment does not track is returned as `unknown` rather than passed through, so
 * the assistant can say "I could not find ABCXYZ" instead of letting a model improvise a price
 * for a company that may not exist. That is the single most valuable guard in the whole feature.
 */
export function extractSymbols(question: string, universe: ReadonlySet<string>): SymbolExtraction {
  const symbols: string[] = []
  const unknown: string[] = []
  const seen = new Set<string>()

  // `$NVDA` is an explicit ticker mention and skips the lookalike filter entirely.
  const tokens = question.match(/\$?[A-Za-z][A-Za-z0-9.\-&]{0,19}/g) ?? []

  for (const raw of tokens) {
    const explicit = raw.startsWith("$")
    const token = (explicit ? raw.slice(1) : raw).toUpperCase()
    if (token.length === 0 || token.length > 20) continue
    if (!explicit && TICKER_LOOKALIKES.has(token)) continue
    if (seen.has(token)) continue

    if (universe.has(token)) {
      seen.add(token)
      if (symbols.length < MAX_SYMBOLS_PER_REQUEST) symbols.push(token)
    } else if (explicit) {
      // Only an explicit `$TICKER` is worth reporting back. Every other unmatched word is just a
      // word, and listing them all would be noise.
      seen.add(token)
      unknown.push(token)
    }
  }

  return { symbols, unknown }
}

// ---------------------------------------------------------------- safety vocabulary

/**
 * Language Stockly AI must never produce.
 *
 * Stockly describes; it does not advise, and it does not predict. This list is the machine-checked
 * half of that promise: the model is told the rule in its system prompt, and then the output is
 * checked against these patterns before anything reaches the browser. A prompt alone is a wish.
 */
export const FORBIDDEN_PATTERNS: readonly { pattern: RegExp; reason: string }[] = [
  // Up to three words of slack between the advice verb and the trade verb, so "I recommend
  // selling half" and "you should consider trimming" are caught while a longer sentence that
  // merely contains both words is not.
  {
    pattern:
      /\b(?:you should|you ought to|i(?:'d| would)? recommend|i recommend|i suggest(?: that)?(?: you)?)\s+(?:\w+\s+){0,3}?(?:buy|sell|short|dump|hold|trim|exit)(?:ing|s)?\b/i,
    reason: "direct trade advice",
  },
  { pattern: /\b(?:buy|sell|short)\s+(?:it|this|now|immediately|today)\b/i, reason: "direct trade instruction" },
  { pattern: /\b(?:strong buy|strong sell|price target|target price)\b/i, reason: "analyst rating or price target" },
  { pattern: /\b(?:guaranteed?|guarantee|risk[- ]free|sure thing|can't lose|cannot lose)\b/i, reason: "guarantee" },
  { pattern: /\bwill (?:definitely |certainly |surely )?(?:rise|fall|go up|go down|crash|moon|double|triple|reach)\b/i, reason: "price prediction" },
  { pattern: /\b(?:is going to|gonna) (?:rise|fall|go up|go down|crash|moon|double|explode)\b/i, reason: "price prediction" },
  { pattern: /\bexpect(?:ed)? (?:to )?(?:gain|return|rise by|fall by)\s+\d/i, reason: "quantified forecast" },
]

/** Every rule the text broke. Empty means the text is clean. */
export function findAdviceLanguage(text: string): string[] {
  return FORBIDDEN_PATTERNS.filter((rule) => rule.pattern.test(text)).map((rule) => rule.reason)
}

// ---------------------------------------------------------------- data completeness

export type DataPoint = { ref: DataPointRef; available: boolean }

export type DataCompleteness = {
  /** Percentage of the expected data points that were actually retrieved. */
  coveragePct: number
  /**
   * **A measure of how much data was available, and nothing else.** It is not a probability, a
   * conviction level, or an opinion about where a price is going. The UI says so in words.
   */
  level: "high" | "partial" | "low"
  available: DataPointRef[]
  missing: DataPointRef[]
}

/**
 * What a coverage point *is*, rather than what it is called.
 *
 * Phase 21: these labels are rendered on screen ("unavailable: NVDA price, Watchlist"), so an
 * English string here would be an English string in a Thai answer. `code` picks the message and
 * `symbol` fills its placeholder — the same facts-not-prose split the rest of the domain uses.
 */
export type DataPointRef = { code: string; symbol?: string }

export function assessCompleteness(points: readonly DataPoint[]): DataCompleteness {
  if (points.length === 0) {
    return { coveragePct: 0, level: "low", available: [], missing: [] }
  }
  const available = points.filter((p) => p.available).map((p) => p.ref)
  const missing = points.filter((p) => !p.available).map((p) => p.ref)
  const coveragePct = Math.round((available.length / points.length) * 100)
  const level = coveragePct >= 80 ? "high" : coveragePct >= 50 ? "partial" : "low"
  return { coveragePct, level, available, missing }
}

// ---------------------------------------------------------------- history summary

export type HistorySummary = {
  bars: number
  firstDate: string
  lastDate: string
  changePct: number | null
  high52w: number | null
  low52w: number | null
  /** Distance from the 52-week high, in percent — negative means below it. */
  fromHighPct: number | null
  fromLowPct: number | null
  /** Annualised standard deviation of daily returns, in percent. */
  volatilityPct: number | null
  return1mPct: number | null
  return3mPct: number | null
}

const TRADING_DAYS_PER_YEAR = 252

const pctChange = (from: number, to: number): number | null =>
  from === 0 ? null : ((to - from) / from) * 100

/**
 * Five years of OHLCV is tens of thousands of numbers and no model needs them.
 *
 * Sending a whole series costs a fortune in tokens, buries the signal, and invites the model to do
 * arithmetic Stockly has already done correctly. This reduces the series to the handful of facts a
 * written summary actually cites — and everything it returns is computed here, not by the model.
 */
export function summarizeHistory(candles: readonly Candle[]): HistorySummary | null {
  if (candles.length === 0) return null

  const closes = candles.map((c) => c.close)
  const last = closes[closes.length - 1]
  const first = closes[0]

  // A year of trading days, or whatever is available.
  const window = closes.slice(-TRADING_DAYS_PER_YEAR)
  const high52w = Math.max(...window)
  const low52w = Math.min(...window)

  let volatilityPct: number | null = null
  if (closes.length >= 21) {
    const returns: number[] = []
    for (let i = 1; i < closes.length; i += 1) {
      if (closes[i - 1] !== 0) returns.push(closes[i] / closes[i - 1] - 1)
    }
    if (returns.length >= 20) {
      const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length
      const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length
      volatilityPct = Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100
    }
  }

  const at = (barsAgo: number): number | null =>
    closes.length > barsAgo ? closes[closes.length - 1 - barsAgo] : null

  const oneMonth = at(21)
  const threeMonths = at(63)

  return {
    bars: candles.length,
    firstDate: candles[0].date,
    lastDate: candles[candles.length - 1].date,
    changePct: pctChange(first, last),
    high52w,
    low52w,
    fromHighPct: pctChange(high52w, last),
    fromLowPct: pctChange(low52w, last),
    volatilityPct,
    return1mPct: oneMonth === null ? null : pctChange(oneMonth, last),
    return3mPct: threeMonths === null ? null : pctChange(threeMonths, last),
  }
}
