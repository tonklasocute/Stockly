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
}

/** Which alerts need a symbol, and which are about the portfolio as a whole. */
export const SYMBOL_ALERT_TYPES: readonly AlertType[] = [
  "PRICE_ABOVE",
  "PRICE_BELOW",
  "PERCENT_CHANGE_ABOVE",
  "PERCENT_CHANGE_BELOW",
  "POSITION_WEIGHT_ABOVE",
  "POSITION_WEIGHT_BELOW",
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
]

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

export type PortfolioReading = {
  dailyChangePct: number | null
  totalReturnPct: number
  /** Weight of each held symbol, 0–100. */
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
export function readingFor(
  alert: AlertRule,
  quotes: Map<string, QuoteReading>,
  portfolio: PortfolioReading | null,
): AlertReading | null {
  const symbol = alert.symbol?.toUpperCase() ?? null

  switch (alert.type) {
    case "PRICE_ABOVE":
    case "PRICE_BELOW": {
      const quote = symbol ? quotes.get(symbol) : undefined
      return quote ? { value: quote.price, asOf: quote.asOf } : null
    }

    case "PERCENT_CHANGE_ABOVE":
    case "PERCENT_CHANGE_BELOW": {
      const quote = symbol ? quotes.get(symbol) : undefined
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
      if (!portfolio || !symbol) return null
      const weight = portfolio.weights[symbol]
      // A symbol that is not held has no weight; treating that as 0% would fire every "below"
      // alert for every stock the user has ever mentioned.
      return weight === undefined ? null : { value: weight, asOf: portfolio.asOf }
    }

    case "DIVIDEND_RECEIVED":
      return null
  }
}

/**
 * Every distinct symbol the given alerts need a quote for.
 *
 * This is what keeps the job from being O(users × alerts) upstream calls: a thousand alerts on
 * NVDA across a hundred users still resolve to one symbol, fetched once.
 */
export function symbolsToFetch(alerts: readonly AlertRule[]): string[] {
  const symbols = new Set<string>()
  for (const alert of alerts) {
    if (!alert.enabled || !alert.symbol) continue
    if (!SYMBOL_ALERT_TYPES.includes(alert.type)) continue
    symbols.add(alert.symbol.toUpperCase())
  }
  return [...symbols]
}

// ---------------------------------------------------------------- messages

export type AlertMessage = { title: string; body: string; href: string }

const money = (value: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value)

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
  currency = "USD",
): AlertMessage {
  const symbol = alert.symbol?.toUpperCase() ?? ""
  const alertsHref = "/alerts"
  const stockHref = symbol ? `/stocks/${symbol}` : alertsHref

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
  }
}

const WEIGHT_TYPES: readonly AlertType[] = ["POSITION_WEIGHT_ABOVE", "POSITION_WEIGHT_BELOW"]

/** A one-line description of the rule itself, for the alerts list. */
export function describeAlert(alert: AlertRule, currency = "USD"): string {
  // A weight is a share, not a move: "40%" of a portfolio, never "+40%".
  const target = WEIGHT_TYPES.includes(alert.type)
    ? `${alert.targetValue.toFixed(2)}%`
    : PERCENT_ALERT_TYPES.includes(alert.type)
      ? percent(alert.targetValue)
      : money(alert.targetValue, currency)
  const subject = alert.symbol ? alert.symbol.toUpperCase() : "Portfolio"

  if (alert.type === "DIVIDEND_RECEIVED") return "Any dividend is recorded"
  return `${subject} · ${ALERT_TYPE_LABELS[alert.type].toLowerCase()} ${target}`
}
