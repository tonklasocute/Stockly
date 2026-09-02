import { currencyOf, symbolKey, type MarketId } from "./market"
import { percentOf, quantize, subtract } from "./money"

/**
 * The alert engine.
 *
 * Pure: no database, no market-data client, no clock of its own. Everything it needs — the alert
 * row, the current reading, the previous reading, the time — is passed in, so every rule below is
 * testable without a running system. The cron job is a thin shell that loads rows, calls
 * `evaluateAlert`, and writes the results back.
 */

export const ALERT_TYPES = [
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PERCENT_CHANGE_ABOVE",
  "PERCENT_CHANGE_BELOW",
  "PORTFOLIO_DAILY_CHANGE_ABOVE",
  "PORTFOLIO_DAILY_CHANGE_BELOW",
  "PORTFOLIO_TOTAL_RETURN_ABOVE",
  "PORTFOLIO_TOTAL_RETURN_BELOW",
  "POSITION_WEIGHT_ABOVE",
  "POSITION_WEIGHT_BELOW",
  "DIVIDEND_RECEIVED",
  // Phase 6 — technical conditions. They ride the same engine: the same crossing rule, the same
  // state machine, the same cooldown and idempotency. Only the reading differs.
  "RSI_ABOVE",
  "RSI_BELOW",
  "MACD_BULLISH_CROSS",
  "MACD_BEARISH_CROSS",
  "PRICE_ABOVE_EMA",
  "PRICE_BELOW_EMA",
  "EMA_CROSS_BULLISH",
  "EMA_CROSS_BEARISH",
  "RELATIVE_VOLUME_ABOVE",
  "ADX_ABOVE",
] as const

export type AlertType = (typeof ALERT_TYPES)[number]

/**
 * Deliberately explicit names. "Gain %" is ambiguous — a portfolio can be up 2% today while down
 * 15% since purchase — so daily change and total return are separate types that can never be
 * confused for one another in the database, the API or the UI.
 */
export const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  PRICE_ABOVE: "Price rises above",
  PRICE_BELOW: "Price falls below",
  PERCENT_CHANGE_ABOVE: "Daily change rises above",
  PERCENT_CHANGE_BELOW: "Daily change falls below",
  PORTFOLIO_DAILY_CHANGE_ABOVE: "Portfolio daily change rises above",
  PORTFOLIO_DAILY_CHANGE_BELOW: "Portfolio daily change falls below",
  PORTFOLIO_TOTAL_RETURN_ABOVE: "Portfolio total return rises above",
  PORTFOLIO_TOTAL_RETURN_BELOW: "Portfolio total return falls below",
  POSITION_WEIGHT_ABOVE: "Position weight rises above",
  POSITION_WEIGHT_BELOW: "Position weight falls below",
  DIVIDEND_RECEIVED: "A dividend is recorded",
  RSI_ABOVE: "RSI rises above",
  RSI_BELOW: "RSI falls below",
  MACD_BULLISH_CROSS: "MACD crosses above its signal",
  MACD_BEARISH_CROSS: "MACD crosses below its signal",
  PRICE_ABOVE_EMA: "Price rises above its EMA by",
  PRICE_BELOW_EMA: "Price falls below its EMA by",
  EMA_CROSS_BULLISH: "50 EMA crosses above the 200 EMA",
  EMA_CROSS_BEARISH: "50 EMA crosses below the 200 EMA",
  RELATIVE_VOLUME_ABOVE: "Relative volume rises above",
  ADX_ABOVE: "ADX rises above",
}

/** Which alerts need a symbol, and which are about the portfolio as a whole. */
export const SYMBOL_ALERT_TYPES: readonly AlertType[] = [
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PERCENT_CHANGE_ABOVE",
  "PERCENT_CHANGE_BELOW",
  "POSITION_WEIGHT_ABOVE",
  "POSITION_WEIGHT_BELOW",
  "RSI_ABOVE",
  "RSI_BELOW",
  "MACD_BULLISH_CROSS",
  "MACD_BEARISH_CROSS",
  "PRICE_ABOVE_EMA",
  "PRICE_BELOW_EMA",
  "EMA_CROSS_BULLISH",
  "EMA_CROSS_BEARISH",
  "RELATIVE_VOLUME_ABOVE",
  "ADX_ABOVE",
]

/**
 * Types whose reading comes from a technical snapshot rather than a quote. They need an OHLCV
 * history, which is a different (and far more expensive) fetch than a batched quote — see
 * docs/TECHNICAL-ANALYSIS.md for how the job keeps that affordable.
 */
export const TECHNICAL_ALERT_TYPES: readonly AlertType[] = [
  "RSI_ABOVE",
  "RSI_BELOW",
  "MACD_BULLISH_CROSS",
  "MACD_BEARISH_CROSS",
  "PRICE_ABOVE_EMA",
  "PRICE_BELOW_EMA",
  "EMA_CROSS_BULLISH",
  "EMA_CROSS_BEARISH",
  "RELATIVE_VOLUME_ABOVE",
  "ADX_ABOVE",
]

/**
 * Types that are already a crossing in their own right. Their reading is 1 on the bar the cross
 * happened and 0 otherwise, so the engine's `armed → triggered` rule fires exactly once per event
 * with no special case — the same machinery, a different input.
 */
export const CROSS_EVENT_ALERT_TYPES: readonly AlertType[] = [
  "MACD_BULLISH_CROSS",
  "MACD_BEARISH_CROSS",
  "EMA_CROSS_BULLISH",
  "EMA_CROSS_BEARISH",
]

/** Types measured in percent rather than currency — it changes the input's suffix and validation. */
export const PERCENT_ALERT_TYPES: readonly AlertType[] = [
  "PERCENT_CHANGE_ABOVE",
  "PERCENT_CHANGE_BELOW",
  "PORTFOLIO_DAILY_CHANGE_ABOVE",
  "PORTFOLIO_DAILY_CHANGE_BELOW",
  "PORTFOLIO_TOTAL_RETURN_ABOVE",
  "PORTFOLIO_TOTAL_RETURN_BELOW",
  "POSITION_WEIGHT_ABOVE",
  "POSITION_WEIGHT_BELOW",
  "PRICE_ABOVE_EMA",
  "PRICE_BELOW_EMA",
]

/**
 * What the target value is measured in. It decides the input's suffix, its validation range and how
 * the number is rendered — an RSI of 30 is not 30% and not $30.
 */
export type AlertUnit = "currency" | "percent" | "index" | "multiple" | "none"

export const ALERT_UNITS: Record<AlertType, AlertUnit> = {
  PRICE_ABOVE: "currency",
  PRICE_BELOW: "currency",
  PERCENT_CHANGE_ABOVE: "percent",
  PERCENT_CHANGE_BELOW: "percent",
  PORTFOLIO_DAILY_CHANGE_ABOVE: "percent",
  PORTFOLIO_DAILY_CHANGE_BELOW: "percent",
  PORTFOLIO_TOTAL_RETURN_ABOVE: "percent",
  PORTFOLIO_TOTAL_RETURN_BELOW: "percent",
  POSITION_WEIGHT_ABOVE: "percent",
  POSITION_WEIGHT_BELOW: "percent",
  DIVIDEND_RECEIVED: "none",
  RSI_ABOVE: "index",
  RSI_BELOW: "index",
  MACD_BULLISH_CROSS: "none",
  MACD_BEARISH_CROSS: "none",
  PRICE_ABOVE_EMA: "percent",
  PRICE_BELOW_EMA: "percent",
  EMA_CROSS_BULLISH: "none",
  EMA_CROSS_BEARISH: "none",
  RELATIVE_VOLUME_ABOVE: "multiple",
  ADX_ABOVE: "index",
}

/** Types the scheduled job evaluates. DIVIDEND_RECEIVED is raised by the write that causes it. */
export const SCHEDULED_ALERT_TYPES: readonly AlertType[] = ALERT_TYPES.filter(
  (type) => type !== "DIVIDEND_RECEIVED",
)

export function isAboveType(type: AlertType): boolean {
  return type.endsWith("_ABOVE")
}

/**
 * State machine.
 *
 *   armed      → the condition is currently false; the alert is waiting to be crossed
 *   triggered  → the condition is true and has already fired; it will not fire again
 *   cooldown   → fired recently; even a fresh crossing is suppressed until the window passes
 *
 * `armed → triggered` is the only transition that produces an event. Returning to `armed` requires
 * the condition to become false again, which is what stops a price hovering at the threshold from
 * producing an alert on every poll.
 */
export type AlertState = "armed" | "triggered" | "cooldown"

export type AlertRule = {
  id: string
  type: AlertType
  symbol: string | null
  /** Which venue `symbol` trades on, and therefore which currency `targetValue` is in. */
  market: MarketId
  /** Currency for price alerts, percent for the rest. */
  targetValue: number
  enabled: boolean
  state: AlertState
  /** The reading at the previous evaluation. Null before the first one. */
  lastValue: number | null
  lastTriggeredAt: string | null
  cooldownMinutes: number
}

/** What the engine is asked to compare against. `asOf` drives the staleness guard. */
export type AlertReading = {
  value: number
  asOf: string
}

export type AlertOutcome =
  | { action: "skip"; reason: SkipReason; nextState?: undefined; nextValue?: undefined }
  | { action: "arm"; nextState: "armed"; nextValue: number }
  | { action: "hold"; nextState: AlertState; nextValue: number }
  | {
      action: "trigger"
      nextState: "triggered"
      nextValue: number
      triggerValue: number
      referenceValue: number
      idempotencyKey: string
    }

export type SkipReason =
  | "disabled"
  | "no-reading"
  | "stale-reading"
  | "market-closed"
  | "not-scheduled"

/** A quote older than this is not evidence of anything; acting on it would be a false alert. */
export const MAX_READING_AGE_MINUTES = 15

export type EvaluationContext = {
  now: Date
  /** Provider-reported market state. "unknown" does not block: staleness is the real guard. */
  marketOpen: boolean | null
  maxReadingAgeMinutes?: number
}

function conditionMet(type: AlertType, value: number, target: number): boolean {
  // Strictly greater / strictly less: a price exactly equal to the target has not crossed it.
  return isAboveType(type) ? value > target : value < target
}

function minutesBetween(from: string | Date, to: Date): number {
  const start = from instanceof Date ? from.getTime() : Date.parse(from)
  if (Number.isNaN(start)) return Number.POSITIVE_INFINITY
  return (to.getTime() - start) / 60_000
}

/**
 * One alert, one reading, one decision.
 *
 * The crossing rule, which is the whole point: an alert fires when the condition becomes true
 * having been false — never merely because it is true. `previous <= target && current > target`,
 * expressed through the stored state rather than by comparing raw prices, so it also survives a
 * missed evaluation or a restart.
 */
export function evaluateAlert(
  alert: AlertRule,
  reading: AlertReading | null,
  context: EvaluationContext,
): AlertOutcome {
  if (!alert.enabled) return { action: "skip", reason: "disabled" }
  if (alert.type === "DIVIDEND_RECEIVED") return { action: "skip", reason: "not-scheduled" }
  if (!reading) return { action: "skip", reason: "no-reading" }

  const maxAge = context.maxReadingAgeMinutes ?? MAX_READING_AGE_MINUTES
  if (minutesBetween(reading.asOf, context.now) > maxAge) {
    // Explicitly marked as skipped rather than silently ignored: a provider outage must be visible
    // in the job's counters, not disguised as "nothing happened".
    return { action: "skip", reason: "stale-reading" }
  }

  // Price-derived alerts are meaningless outside a session; a closed market simply has no new
  // information. `null` (provider cannot say) is treated as open, with staleness as the backstop.
  if (context.marketOpen === false) return { action: "skip", reason: "market-closed" }

  const value = quantize(reading.value)
  const met = conditionMet(alert.type, value, alert.targetValue)

  // The condition is false: the alert is (re)armed, ready for the next genuine crossing.
  if (!met) return { action: "arm", nextState: "armed", nextValue: value }

  // True, but it was already true at the last evaluation — this is not a crossing.
  if (alert.state !== "armed") return { action: "hold", nextState: alert.state, nextValue: value }

  // True and freshly crossed, but the last alert is still inside its quiet window.
  if (
    alert.lastTriggeredAt &&
    minutesBetween(alert.lastTriggeredAt, context.now) < alert.cooldownMinutes
  ) {
    return { action: "hold", nextState: "cooldown", nextValue: value }
  }

  return {
    action: "trigger",
    nextState: "triggered",
    nextValue: value,
    triggerValue: value,
    referenceValue: alert.targetValue,
    // Two concurrent job runs seeing the same crossing produce the same key, and the unique index
    // on it turns the second write into a no-op instead of a duplicate notification.
    idempotencyKey: idempotencyKeyFor(alert.id, context.now, value),
  }
}

/** Same alert, same minute, same reading → same key. */
export function idempotencyKeyFor(alertId: string, at: Date, value: number): string {
  const minute = Math.floor(at.getTime() / 60_000)
  return `${alertId}:${minute}:${quantize(value)}`
}

// ---------------------------------------------------------------- readings

export type QuoteReading = {
  symbol: string
  price: number
  previousClose: number | null
  asOf: string
}

/**
 * The technical facts an alert can be measured against. Deliberately a small, flat shape rather
 * than the whole snapshot: the engine should depend on what it reads, not on how it was computed.
 */
export type TechnicalReading = {
  rsi: number | null
  adx: number | null
  relativeVolume: number | null
  /** Price distance from the 200 EMA, in percent. Positive means above. */
  priceVsEma200Pct: number | null
  macdCross: "bullish" | "bearish" | null
  emaCross50200: "bullish" | "bearish" | null
  asOf: string
}

export type PortfolioReading = {
  dailyChangePct: number | null
  totalReturnPct: number
  /** Weight of each held symbol, 0–100. */
  /**
   * Position weights, keyed by `symbolKey` (`"SET:PTT"`), in the portfolio's base currency. A
   * holding whose currency could not be translated is **absent**, never 0 — a share of the
   * portfolio nobody can compute must not fire a "weight below" alert.
   */
  weights: Record<string, number>
  asOf: string
}

/**
 * Turns market and portfolio state into the single number an alert compares against.
 *
 * Percentage-change alerts are measured against the **previous close**, documented and fixed. The
 * alternative — session open — drifts as the day goes on and would make "+5% today" mean something
 * different at 10am and at 3pm. Null when the provider gave no previous close: unknown, not zero.
 */
/**
 * A crossing type reads 1 on the bar the cross happened and 0 otherwise, against a target of 0.5.
 * That makes the engine's ordinary `armed → triggered` rule fire exactly once per event, with no
 * special-casing anywhere — the same machinery as a price alert, a different input.
 */
function crossReading(
  cross: "bullish" | "bearish" | null,
  wanted: "bullish" | "bearish",
  asOf: string,
): AlertReading {
  return { value: cross === wanted ? 1 : 0, asOf }
}

export function readingFor(
  alert: AlertRule,
  quotes: Map<string, QuoteReading>,
  portfolio: PortfolioReading | null,
  technicals: Map<string, TechnicalReading> = new Map(),
): AlertReading | null {
  const symbol = alert.symbol?.toUpperCase() ?? null
  // Every per-instrument map is keyed by market and symbol together, because "PTT" alone names two
  // different things once more than one exchange is in play.
  const key = symbol ? symbolKey(symbol, alert.market) : null

  switch (alert.type) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW": {
      const quote = key ? quotes.get(key) : undefined
      return quote ? { value: quote.price, asOf: quote.asOf } : null
    }

    case "PERCENT_CHANGE_ABOVE":
    case "PERCENT_CHANGE_BELOW": {
      const quote = key ? quotes.get(key) : undefined
      if (!quote || quote.previousClose === null || quote.previousClose <= 0) return null
      const change = percentOf(subtract(quote.price, quote.previousClose), quote.previousClose)
      return change === null ? null : { value: change, asOf: quote.asOf }
    }

    case "PORTFOLIO_DAILY_CHANGE_ABOVE":
    case "PORTFOLIO_DAILY_CHANGE_BELOW":
      return portfolio?.dailyChangePct === null || !portfolio
        ? null
        : { value: portfolio.dailyChangePct, asOf: portfolio.asOf }

    case "PORTFOLIO_TOTAL_RETURN_ABOVE":
    case "PORTFOLIO_TOTAL_RETURN_BELOW":
      return portfolio ? { value: portfolio.totalReturnPct, asOf: portfolio.asOf } : null

    case "POSITION_WEIGHT_ABOVE":
    case "POSITION_WEIGHT_BELOW": {
      if (!portfolio || !key) return null
      const weight = portfolio.weights[key]
      // A symbol that is not held has no weight; treating that as 0% would fire every "below"
      // alert for every stock the user has ever mentioned.
      return weight === undefined ? null : { value: weight, asOf: portfolio.asOf }
    }

    case "DIVIDEND_RECEIVED":
      return null

    case "RSI_ABOVE":
    case "RSI_BELOW": {
      const t = key ? technicals.get(key) : undefined
      return t?.rsi === null || !t ? null : { value: t.rsi, asOf: t.asOf }
    }

    case "ADX_ABOVE": {
      const t = key ? technicals.get(key) : undefined
      return t?.adx === null || !t ? null : { value: t.adx, asOf: t.asOf }
    }

    case "RELATIVE_VOLUME_ABOVE": {
      const t = key ? technicals.get(key) : undefined
      return t?.relativeVolume === null || !t ? null : { value: t.relativeVolume, asOf: t.asOf }
    }

    case "PRICE_ABOVE_EMA":
    case "PRICE_BELOW_EMA": {
      const t = key ? technicals.get(key) : undefined
      return t?.priceVsEma200Pct === null || !t ? null : { value: t.priceVsEma200Pct, asOf: t.asOf }
    }

    case "MACD_BULLISH_CROSS":
    case "MACD_BEARISH_CROSS": {
      const t = key ? technicals.get(key) : undefined
      if (!t) return null
      return crossReading(t.macdCross, alert.type === "MACD_BULLISH_CROSS" ? "bullish" : "bearish", t.asOf)
    }

    case "EMA_CROSS_BULLISH":
    case "EMA_CROSS_BEARISH": {
      const t = key ? technicals.get(key) : undefined
      if (!t) return null
      return crossReading(t.emaCross50200, alert.type === "EMA_CROSS_BULLISH" ? "bullish" : "bearish", t.asOf)
    }
  }
}

/**
 * Every distinct instrument the given alerts need a quote for.
 *
 * This is what keeps the job from being O(users × alerts) upstream calls: a thousand alerts on
 * NVDA across a hundred users still resolve to one instrument, fetched once. Market is part of the
 * identity, so a SET listing and a US one that spell the same are two fetches, not one wrong one.
 */
export function instrumentsToFetch(
  alerts: readonly AlertRule[],
): { symbol: string; market: MarketId }[] {
  const out = new Map<string, { symbol: string; market: MarketId }>()
  for (const alert of alerts) {
    if (!alert.enabled || !alert.symbol) continue
    if (!SYMBOL_ALERT_TYPES.includes(alert.type)) continue
    const symbol = alert.symbol.toUpperCase()
    out.set(symbolKey(symbol, alert.market), { symbol, market: alert.market })
  }
  return [...out.values()]
}

// ---------------------------------------------------------------- messages

export type AlertMessage = { title: string; body: string; href: string }

const money = (value: number, currency: string) =>
  // narrowSymbol so $ and ฿ are distinguishable at a glance in a lock-screen notification.
  new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).format(
    value,
  )

const percent = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)}%`

/**
 * The text a user sees, and — importantly — the text that goes into a push payload.
 *
 * Prices and percentage moves for a symbol are public market data and are named outright, because a
 * notification that will not say what happened is useless. **Portfolio figures are never included**:
 * a lock-screen preview should not tell a bystander what someone's portfolio is worth or how it is
 * doing. Those messages point at the app instead.
 */
export function messageFor(
  alert: AlertRule,
  triggerValue: number,
  /**
   * Defaults to the currency the instrument is quoted in, which is the only currency a price alert
   * is ever set in. A caller that knows better — a portfolio-level message — can still override it.
   */
  currency: string = currencyOf(alert.market),
): AlertMessage {
  const symbol = alert.symbol?.toUpperCase() ?? ""
  const alertsHref = "/alerts"
  // The market is in the link so the page prices it in the right currency when it opens.
  const stockHref = symbol ? `/stocks/${symbol}?market=${alert.market}` : alertsHref

  switch (alert.type) {
    case "PRICE_ABOVE":
      return {
        title: `${symbol} rose above ${money(alert.targetValue, currency)}`,
        body: `Now trading at ${money(triggerValue, currency)}.`,
        href: stockHref,
      }
    case "PRICE_BELOW":
      return {
        title: `${symbol} fell below ${money(alert.targetValue, currency)}`,
        body: `Now trading at ${money(triggerValue, currency)}.`,
        href: stockHref,
      }
    case "PERCENT_CHANGE_ABOVE":
    case "PERCENT_CHANGE_BELOW":
      return {
        title: `${symbol} is ${percent(triggerValue)} today`,
        body: `Your alert was set at ${percent(alert.targetValue)} from the previous close.`,
        href: stockHref,
      }
    case "POSITION_WEIGHT_ABOVE":
    case "POSITION_WEIGHT_BELOW":
      // A weight is a fact about the user's portfolio; the number stays inside the app.
      return {
        title: `${symbol} passed your position size alert`,
        body: "Open Stockly to see the current weight.",
        href: "/analytics",
      }
    case "PORTFOLIO_DAILY_CHANGE_ABOVE":
    case "PORTFOLIO_DAILY_CHANGE_BELOW":
      return {
        title: "Your portfolio passed a daily change alert",
        body: "Open Stockly to see today's movement.",
        href: "/dashboard",
      }
    case "PORTFOLIO_TOTAL_RETURN_ABOVE":
    case "PORTFOLIO_TOTAL_RETURN_BELOW":
      return {
        title: "Your portfolio passed a total return alert",
        body: "Open Stockly to see the details.",
        href: "/analytics",
      }
    case "DIVIDEND_RECEIVED":
      return {
        title: `Dividend recorded${symbol ? ` for ${symbol}` : ""}`,
        body: "Open Stockly to see the payment.",
        href: "/dividends",
      }

    // Technical readings are derived from public price and volume history, so they are named
    // outright — the same rule as prices, and for the same reason.
    case "RSI_ABOVE":
    case "RSI_BELOW":
      return {
        title: `${symbol} RSI is ${triggerValue.toFixed(1)}`,
        body: `Your alert was set at ${alert.targetValue.toFixed(0)}.`,
        href: stockHref,
      }
    case "ADX_ABOVE":
      return {
        title: `${symbol} ADX rose above ${alert.targetValue.toFixed(0)}`,
        body: `Now ${triggerValue.toFixed(1)} — a strengthening trend, in either direction.`,
        href: stockHref,
      }
    case "RELATIVE_VOLUME_ABOVE":
      return {
        title: `${symbol} volume is ${triggerValue.toFixed(1)}× its average`,
        body: `Your alert was set at ${alert.targetValue.toFixed(1)}×.`,
        href: stockHref,
      }
    case "PRICE_ABOVE_EMA":
    case "PRICE_BELOW_EMA":
      return {
        title: `${symbol} is ${percent(triggerValue)} from its 200 EMA`,
        body: `Your alert was set at ${percent(alert.targetValue)}.`,
        href: stockHref,
      }
    case "MACD_BULLISH_CROSS":
      return {
        title: `${symbol} MACD crossed above its signal`,
        body: "A momentum crossover on the daily chart.",
        href: stockHref,
      }
    case "MACD_BEARISH_CROSS":
      return {
        title: `${symbol} MACD crossed below its signal`,
        body: "A momentum crossover on the daily chart.",
        href: stockHref,
      }
    case "EMA_CROSS_BULLISH":
      return {
        title: `${symbol}: the 50 EMA crossed above the 200`,
        body: "A golden cross on the daily chart.",
        href: stockHref,
      }
    case "EMA_CROSS_BEARISH":
      return {
        title: `${symbol}: the 50 EMA crossed below the 200`,
        body: "A death cross on the daily chart.",
        href: stockHref,
      }
  }
}

const WEIGHT_TYPES: readonly AlertType[] = ["POSITION_WEIGHT_ABOVE", "POSITION_WEIGHT_BELOW"]

/** Renders a target in the unit its type is measured in. */
export function formatTarget(alert: AlertRule, currency = "USD"): string {
  switch (ALERT_UNITS[alert.type]) {
    case "currency":
      return money(alert.targetValue, currency)
    case "index":
      return alert.targetValue.toFixed(0)
    case "multiple":
      return `${alert.targetValue.toFixed(1)}×`
    case "none":
      return ""
    case "percent":
      // A weight is a share, not a move: "40%" of a portfolio, never "+40%".
      return WEIGHT_TYPES.includes(alert.type)
        ? `${alert.targetValue.toFixed(2)}%`
        : percent(alert.targetValue)
  }
}

/** A one-line description of the rule itself, for the alerts list. */
export function describeAlert(alert: AlertRule, currency = "USD"): string {
  const subject = alert.symbol ? alert.symbol.toUpperCase() : "Portfolio"
  if (alert.type === "DIVIDEND_RECEIVED") return "Any dividend is recorded"

  const target = formatTarget(alert, currency)
  const label = ALERT_TYPE_LABELS[alert.type].toLowerCase()
  return target ? `${subject} · ${label} ${target}` : `${subject} · ${label}`
}
