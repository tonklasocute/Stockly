import type { TechnicalSnapshot, Trend } from "./technical"

/**
 * The screener.
 *
 * **Every filter is a closed enum: metric, operator, value.** There is no expression language, no
 * string a user writes that the server evaluates. That is the whole security design — `RSI < 30`
 * arrives as `{ metric: "RSI", operator: "LT", value: 30 }` and is looked up in the tables below,
 * so a filter can never be anything the code does not already know how to do.
 *
 * Pure: it evaluates snapshots that were computed elsewhere. It never fetches anything.
 */

export const SCREENER_METRICS = [
  "PRICE",
  "MARKET_CAP",
  "VOLUME",
  "RELATIVE_VOLUME",
  "RSI",
  "ADX",
  "ATR_PCT",
  "TECHNICAL_SCORE",
  "MACD_HISTOGRAM",
  "PRICE_VS_EMA50",
  "PRICE_VS_EMA200",
  "PRICE_VS_SMA200",
  "EMA50_VS_EMA200",
  "TREND",
] as const

export type ScreenerMetric = (typeof SCREENER_METRICS)[number]

export const SCREENER_OPERATORS = ["GT", "GTE", "LT", "LTE", "EQ", "CROSS_ABOVE", "CROSS_BELOW"] as const
export type ScreenerOperator = (typeof SCREENER_OPERATORS)[number]

export type ScreenerFilter = {
  metric: ScreenerMetric
  operator: ScreenerOperator
  /** A number for numeric metrics, a trend name for TREND. */
  value: number | Trend
}

export type ScreenerLogic = "AND" | "OR"

export type ScreenerDefinition = {
  logic: ScreenerLogic
  filters: ScreenerFilter[]
  sort?: { metric: ScreenerMetric; direction: "asc" | "desc" }
}

export const METRIC_LABELS: Record<ScreenerMetric, string> = {
  PRICE: "Price",
  MARKET_CAP: "Market cap",
  VOLUME: "Volume",
  RELATIVE_VOLUME: "Relative volume",
  RSI: "RSI (14)",
  ADX: "ADX (14)",
  ATR_PCT: "ATR % of price",
  TECHNICAL_SCORE: "Technical score",
  MACD_HISTOGRAM: "MACD histogram",
  PRICE_VS_EMA50: "Price vs 50 EMA (%)",
  PRICE_VS_EMA200: "Price vs 200 EMA (%)",
  PRICE_VS_SMA200: "Price vs 200 SMA (%)",
  EMA50_VS_EMA200: "50 EMA vs 200 EMA (%)",
  TREND: "Trend",
}

export const OPERATOR_LABELS: Record<ScreenerOperator, string> = {
  GT: "is above",
  GTE: "is at or above",
  LT: "is below",
  LTE: "is at or below",
  EQ: "is",
  CROSS_ABOVE: "just crossed above",
  CROSS_BELOW: "just crossed below",
}

/** Which metrics are a percentage difference rather than an absolute value. */
export const RELATIVE_METRICS: readonly ScreenerMetric[] = [
  "PRICE_VS_EMA50",
  "PRICE_VS_EMA200",
  "PRICE_VS_SMA200",
  "EMA50_VS_EMA200",
]

/** Crossing operators only make sense for the two metrics that track a crossing. */
export const CROSSABLE_METRICS: readonly ScreenerMetric[] = ["MACD_HISTOGRAM", "EMA50_VS_EMA200"]

/** Extra facts a snapshot does not carry: they come from the quote, not from the candles. */
export type ScreenerContext = {
  marketCap: number | null
  volume: number | null
}

const relative = (a: number | null, b: number | null): number | null =>
  a === null || b === null || b === 0 ? null : ((a - b) / b) * 100

/**
 * Reads one metric off a snapshot. `null` means "not computable for this stock", which excludes it
 * from the result rather than counting as zero — a stock with too little history is not a stock
 * with an RSI of 0.
 */
export function readMetric(
  snapshot: TechnicalSnapshot,
  context: ScreenerContext,
  metric: ScreenerMetric,
): number | Trend | null {
  switch (metric) {
    case "PRICE":
      return snapshot.price
    case "MARKET_CAP":
      return context.marketCap
    case "VOLUME":
      return context.volume
    case "RELATIVE_VOLUME":
      return snapshot.relativeVolume
    case "RSI":
      return snapshot.rsi
    case "ADX":
      return snapshot.adx
    case "ATR_PCT":
      return snapshot.atrPct
    case "TECHNICAL_SCORE":
      return snapshot.score
    case "MACD_HISTOGRAM":
      return snapshot.macdHistogram
    case "PRICE_VS_EMA50":
      return relative(snapshot.price, snapshot.ema[50] ?? null)
    case "PRICE_VS_EMA200":
      return relative(snapshot.price, snapshot.ema[200] ?? null)
    case "PRICE_VS_SMA200":
      return relative(snapshot.price, snapshot.sma[200] ?? null)
    case "EMA50_VS_EMA200":
      return relative(snapshot.ema[50] ?? null, snapshot.ema[200] ?? null)
    case "TREND":
      return snapshot.trend
  }
}

/**
 * A crossing metric is answered by the snapshot's stored cross, not by comparing a value to a
 * threshold — the same distinction the alert engine makes. "MACD crossed above" is a fact about the
 * last bar; "MACD histogram > 0" is true for as long as the trend lasts.
 */
function matchesCross(
  snapshot: TechnicalSnapshot,
  metric: ScreenerMetric,
  operator: "CROSS_ABOVE" | "CROSS_BELOW",
): boolean {
  const wanted = operator === "CROSS_ABOVE" ? "bullish" : "bearish"
  if (metric === "MACD_HISTOGRAM") return snapshot.macdCross === wanted
  if (metric === "EMA50_VS_EMA200") return snapshot.emaCross50200 === wanted
  return false
}

export function matchesFilter(
  snapshot: TechnicalSnapshot,
  context: ScreenerContext,
  filter: ScreenerFilter,
): boolean {
  if (filter.operator === "CROSS_ABOVE" || filter.operator === "CROSS_BELOW") {
    return matchesCross(snapshot, filter.metric, filter.operator)
  }

  const actual = readMetric(snapshot, context, filter.metric)
  if (actual === null) return false

  if (filter.metric === "TREND") {
    return filter.operator === "EQ" && actual === filter.value
  }
  if (typeof actual !== "number" || typeof filter.value !== "number") return false

  switch (filter.operator) {
    case "GT":
      return actual > filter.value
    case "GTE":
      return actual >= filter.value
    case "LT":
      return actual < filter.value
    case "LTE":
      return actual <= filter.value
    case "EQ":
      return actual === filter.value
  }
}

export function matchesDefinition(
  snapshot: TechnicalSnapshot,
  context: ScreenerContext,
  definition: ScreenerDefinition,
): boolean {
  // No filters matches everything: an empty screen is "show me the universe", not "show me nothing".
  if (definition.filters.length === 0) return true

  return definition.logic === "OR"
    ? definition.filters.some((f) => matchesFilter(snapshot, context, f))
    : definition.filters.every((f) => matchesFilter(snapshot, context, f))
}

export type ScreenerCandidate = { snapshot: TechnicalSnapshot; context: ScreenerContext }

export type ScreenerResult = {
  matches: ScreenerCandidate[]
  /** How many of the universe were examined, and how many had enough history to judge. */
  examined: number
  evaluable: number
}

/**
 * Runs a definition over already-computed snapshots and sorts the result.
 *
 * Sorting puts `null` last regardless of direction: a stock with no ADX is not the lowest-ADX stock,
 * and letting it lead an ascending sort would fill the first page with unanalysable names.
 */
export function runScreen(
  candidates: readonly ScreenerCandidate[],
  definition: ScreenerDefinition,
): ScreenerResult {
  const evaluable = candidates.filter((c) => c.snapshot.candleCount > 0)
  const matches = evaluable.filter((c) => matchesDefinition(c.snapshot, c.context, definition))

  const sort = definition.sort
  if (sort) {
    const direction = sort.direction === "asc" ? 1 : -1
    matches.sort((a, b) => {
      const av = readMetric(a.snapshot, a.context, sort.metric)
      const bv = readMetric(b.snapshot, b.context, sort.metric)
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * direction
      }
      return (av - bv) * direction
    })
  }

  return { matches, examined: candidates.length, evaluable: evaluable.length }
}

// ---------------------------------------------------------------- presets

export type ScreenerPreset = {
  id: string
  name: string
  description: string
  definition: ScreenerDefinition
}

/**
 * Presets are ordinary definitions, shown in full in the UI. Nothing is hidden behind a name: a
 * user can see exactly which conditions "Oversold" means and edit them.
 */
export const SCREENER_PRESETS: readonly ScreenerPreset[] = [
  {
    id: "oversold",
    name: "Oversold",
    description: "RSI below 30 while still above the 200 EMA — weak short-term, intact long-term trend.",
    definition: {
      logic: "AND",
      filters: [
        { metric: "RSI", operator: "LT", value: 30 },
        { metric: "PRICE_VS_EMA200", operator: "GT", value: 0 },
      ],
      sort: { metric: "RSI", direction: "asc" },
    },
  },
  {
    id: "strong-trend",
    name: "Strong trend",
    description: "ADX above 25 with the 50 EMA above the 200 EMA.",
    definition: {
      logic: "AND",
      filters: [
        { metric: "ADX", operator: "GT", value: 25 },
        { metric: "EMA50_VS_EMA200", operator: "GT", value: 0 },
      ],
      sort: { metric: "ADX", direction: "desc" },
    },
  },
  {
    id: "volume-breakout",
    name: "Volume breakout",
    description: "Volume at twice its average with price above the 50 EMA.",
    definition: {
      logic: "AND",
      filters: [
        { metric: "RELATIVE_VOLUME", operator: "GTE", value: 2 },
        { metric: "PRICE_VS_EMA50", operator: "GT", value: 0 },
      ],
      sort: { metric: "RELATIVE_VOLUME", direction: "desc" },
    },
  },
  {
    id: "above-200",
    name: "Above the 200 EMA",
    description: "Price trading above its 200 EMA.",
    definition: {
      logic: "AND",
      filters: [{ metric: "PRICE_VS_EMA200", operator: "GT", value: 0 }],
      sort: { metric: "PRICE_VS_EMA200", direction: "desc" },
    },
  },
  {
    id: "momentum",
    name: "Momentum",
    description: "MACD above its signal, RSI between 55 and 70, volume above average.",
    definition: {
      logic: "AND",
      filters: [
        { metric: "MACD_HISTOGRAM", operator: "GT", value: 0 },
        { metric: "RSI", operator: "GTE", value: 55 },
        { metric: "RSI", operator: "LTE", value: 70 },
        { metric: "RELATIVE_VOLUME", operator: "GTE", value: 1 },
      ],
      sort: { metric: "TECHNICAL_SCORE", direction: "desc" },
    },
  },
  {
    id: "golden-cross",
    name: "Golden cross",
    description: "The 50 EMA crossed above the 200 EMA on the most recent bar.",
    definition: {
      logic: "AND",
      filters: [{ metric: "EMA50_VS_EMA200", operator: "CROSS_ABOVE", value: 0 }],
      sort: { metric: "TECHNICAL_SCORE", direction: "desc" },
    },
  },
]
