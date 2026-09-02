/**
 * Market calendars.
 *
 * "Is the market open?" is a question about a place, not about the person asking. A user in Bangkok
 * looking at NVDA needs New York's clock and New York's holidays; the browser's timezone answers a
 * different question and answers it wrongly for half the world. So every function here takes a
 * market, resolves the wall clock in that market's own timezone through `Intl`, and never touches
 * the ambient locale.
 *
 * **The provider's reported status always wins over this table.** A calendar is a prediction about
 * an exchange's behaviour; the exchange's own answer is a fact. This exists for the cases where no
 * provider answer is available — labelling a chart, scheduling a snapshot, deciding whether a
 * missing quote is an outage or a Sunday — and for those, being explicit about what it does not
 * know matters more than always producing a boolean. Past `calendarVerifiedThrough` a weekday
 * returns "unknown", never "open": an unlisted holiday is exactly the case that would otherwise
 * make Stockly claim a shut exchange was trading.
 *
 * Pure: no clock of its own, no `Date.now()`, no framework.
 */
import { MARKET_REGISTRY, type MarketId, type TradingSession } from "./market"

export type MarketSessionStatus = "open" | "pre" | "post" | "closed" | "unknown"

/** Minutes since local midnight for an "HH:MM" string. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":")
  return Number(h) * 60 + Number(m)
}

const PART_CACHE = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = PART_CACHE.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      weekday: "short",
    })
    PART_CACHE.set(timeZone, formatter)
  }
  return formatter
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

/** An instant, expressed in one market's local wall clock. */
export type MarketClock = {
  /** ISO date in the market's timezone — not the same calendar day as the caller's. */
  date: string
  /** 0 = Sunday, in the market's timezone. */
  weekday: number
  /** Minutes since local midnight. */
  minutes: number
  timeZone: string
}

export function marketClock(market: MarketId, at: Date): MarketClock {
  const definition = MARKET_REGISTRY[market]
  const parts = formatterFor(definition.timeZone).formatToParts(at)
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00"

  // `hour: "2-digit"` with hour12:false renders midnight as "24" in some ICU versions.
  const hour = Number(get("hour")) % 24
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: WEEKDAYS[get("weekday")] ?? 0,
    minutes: hour * 60 + Number(get("minute")),
    timeZone: definition.timeZone,
  }
}

/** The date in the market's own timezone. "Today" on SET is not "today" in New York. */
export function marketDate(market: MarketId, at: Date): string {
  return marketClock(market, at).date
}

function withinSession(minutes: number, session: TradingSession): boolean {
  return minutes >= minutesOf(session.open) && minutes < minutesOf(session.close)
}

function isWeekend(market: MarketId, weekday: number): boolean {
  return MARKET_REGISTRY[market].weekend.includes(weekday)
}

/** True when the holiday table can be trusted for this date. */
export function calendarCovers(market: MarketId, isoDate: string): boolean {
  return isoDate <= MARKET_REGISTRY[market].calendarVerifiedThrough
}

export function isMarketHoliday(market: MarketId, isoDate: string): boolean {
  return MARKET_REGISTRY[market].holidays.includes(isoDate)
}

/**
 * Whether the exchange trades on this date.
 *
 * `null` means "not known" — a weekday beyond the verified horizon — and callers must treat it as
 * unknown rather than as either answer. A weekend is knowable forever, so it still returns false.
 */
export function isTradingDay(market: MarketId, isoDate: string): boolean | null {
  const weekday = new Date(`${isoDate}T00:00:00Z`).getUTCDay()
  if (Number.isNaN(weekday)) return null
  if (isWeekend(market, weekday)) return false
  if (isMarketHoliday(market, isoDate)) return false
  return calendarCovers(market, isoDate) ? true : null
}

/**
 * Where an instant falls in the market's day. "unknown" is a real answer and the UI shows it as
 * such — see the module comment for why a guess would be worse.
 */
export function marketSessionStatus(market: MarketId, at: Date): MarketSessionStatus {
  const definition = MARKET_REGISTRY[market]
  const clock = marketClock(market, at)

  if (isWeekend(market, clock.weekday)) return "closed"
  if (isMarketHoliday(market, clock.date)) return "closed"
  if (!calendarCovers(market, clock.date)) return "unknown"

  if (definition.sessions.some((s) => withinSession(clock.minutes, s))) return "open"
  if (definition.preSession && withinSession(clock.minutes, definition.preSession)) return "pre"
  if (definition.postSession && withinSession(clock.minutes, definition.postSession)) return "post"
  return "closed"
}

export function isMarketOpen(market: MarketId, at: Date): boolean | null {
  const status = marketSessionStatus(market, at)
  return status === "unknown" ? null : status === "open"
}

function shiftDate(isoDate: string, days: number): string {
  const at = new Date(`${isoDate}T00:00:00Z`)
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

/**
 * The next date the market trades, searching forward at most `limit` days. Null when the search
 * runs past the verified calendar — better than naming a day that might be a holiday.
 */
export function nextTradingDay(market: MarketId, isoDate: string, limit = 14): string | null {
  for (let i = 1; i <= limit; i += 1) {
    const candidate = shiftDate(isoDate, i)
    const trading = isTradingDay(market, candidate)
    if (trading === null) return null
    if (trading) return candidate
  }
  return null
}

export function previousTradingDay(market: MarketId, isoDate: string, limit = 14): string | null {
  for (let i = 1; i <= limit; i += 1) {
    const candidate = shiftDate(isoDate, -i)
    const trading = isTradingDay(market, candidate)
    if (trading === null) return null
    if (trading) return candidate
  }
  return null
}

/**
 * Trading days in `[from, to]`, inclusive. Null as soon as one day in the range is unknown: a
 * partial count presented as a total is the kind of quietly-wrong number this codebase avoids.
 */
export function tradingDays(market: MarketId, from: string, to: string): string[] | null {
  if (from > to) return []
  const out: string[] = []
  for (let date = from; date <= to; date = shiftDate(date, 1)) {
    const trading = isTradingDay(market, date)
    if (trading === null) return null
    if (trading) out.push(date)
  }
  return out
}
