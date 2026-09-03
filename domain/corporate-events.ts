import type { Currency, MarketId } from "./market"

/**
 * Corporate events: things a company does that a holder should know about.
 *
 * The rule this module exists to enforce is short and absolute:
 *
 *   **An event is a notice. It never becomes a transaction.**
 *
 * A dividend event says a company declared a payment; the dividend a user *received* is a row they
 * recorded, and only that row reaches the cash engine. A split event says the share count changed;
 * the position that changed is the one the user's transactions describe. Ingesting a thousand
 * events cannot move a single figure — `fundamentals-invariants.test.ts` asserts it.
 *
 * Pure: no client, no network, no framework import.
 */

export const EVENT_TYPES = [
  "EARNINGS",
  "DIVIDEND",
  "EX_DIVIDEND",
  "SPLIT",
  "REVERSE_SPLIT",
  "RIGHTS_OFFERING",
  "TENDER_OFFER",
  "MERGER",
  "ACQUISITION",
  "AGM",
  "EGM",
  "OTHER",
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const EVENT_LABELS: Record<EventType, string> = {
  EARNINGS: "Earnings",
  DIVIDEND: "Dividend payment",
  EX_DIVIDEND: "Ex-dividend",
  SPLIT: "Share split",
  REVERSE_SPLIT: "Reverse split",
  RIGHTS_OFFERING: "Rights offering",
  TENDER_OFFER: "Tender offer",
  MERGER: "Merger",
  ACQUISITION: "Acquisition",
  AGM: "Annual general meeting",
  EGM: "Extraordinary general meeting",
  OTHER: "Corporate action",
}

/**
 * Which event types a market's data actually covers.
 *
 * Not every market supplies every type, and pretending otherwise produces an empty calendar that
 * looks like "nothing is happening" rather than "we do not have this". A type absent from a
 * market's list is reported as uncovered, never as no events.
 */
export const MARKET_EVENT_COVERAGE: Record<MarketId, readonly EventType[]> = {
  US: ["EARNINGS", "DIVIDEND", "EX_DIVIDEND", "SPLIT", "REVERSE_SPLIT", "MERGER", "ACQUISITION", "OTHER"],
  // SET publishes XD/XR/XW and meeting notices; earnings dates are less consistently supplied.
  SET: ["DIVIDEND", "EX_DIVIDEND", "RIGHTS_OFFERING", "AGM", "EGM", "SPLIT", "OTHER"],
}

export function coversEvent(market: MarketId, type: EventType): boolean {
  return MARKET_EVENT_COVERAGE[market].includes(type)
}

export const EVENT_STATUSES = ["UPCOMING", "REPORTED", "UNKNOWN"] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export type CorporateEvent = {
  symbol: string
  market: MarketId
  type: EventType
  /**
   * When it happens. Null when the provider gave none — an event whose date is unknown is still
   * worth listing, and inventing one would put it on a calendar on a day nothing happens.
   */
  date: string | null
  /**
   * **True when the provider's date is an estimate rather than a confirmation.**
   *
   * Surfaced in the UI on every occurrence. An estimated earnings date presented as confirmed is
   * the single most misleading thing a calendar can do, because a reader plans around it.
   */
  estimated: boolean
  status: EventStatus
  title: string
  /** Free text from the provider, already trimmed and bounded at the boundary. */
  detail: string | null
  /** For dividend events: the amount per share, in the currency it is paid in. */
  amountPerShare: number | null
  currency: Currency | null
  /** For splits: "4:1". Null for everything else. */
  ratio: string | null
  source: string
  fetchedAt: string
}

/**
 * An event's status from its date.
 *
 * A dateless event is `UNKNOWN`, never `UPCOMING`: "we do not know when" and "it has not happened
 * yet" are different statements, and only one of them belongs on a calendar.
 */
export function statusOf(event: Pick<CorporateEvent, "date">, now: Date): EventStatus {
  if (event.date === null) return "UNKNOWN"
  const today = now.toISOString().slice(0, 10)
  return event.date >= today ? "UPCOMING" : "REPORTED"
}

/** Events on or after today, soonest first. Dateless events are excluded — a calendar needs dates. */
export function upcoming(events: readonly CorporateEvent[], now: Date, limit = 20): CorporateEvent[] {
  const today = now.toISOString().slice(0, 10)
  return events
    .filter((event) => event.date !== null && event.date >= today)
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""))
    .slice(0, limit)
}

/**
 * De-duplicates a provider's events.
 *
 * Providers re-send the same event as its date firms up, so the same earnings release arrives twice
 * — once estimated, once confirmed. The **confirmed one wins**: a later fetch that downgraded a
 * confirmed date back to an estimate would be a regression in what the user is told.
 */
export function dedupeEvents(events: readonly CorporateEvent[]): CorporateEvent[] {
  const byKey = new Map<string, CorporateEvent>()

  for (const event of events) {
    // Keyed without the date, so a re-dated event replaces rather than duplicating.
    const key = `${event.market}:${event.symbol}:${event.type}:${event.date?.slice(0, 7) ?? "unknown"}`
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, event)
      continue
    }
    // A confirmed date replaces an estimate; an estimate never replaces a confirmation.
    if (existing.estimated && !event.estimated) byKey.set(key, event)
  }

  return [...byKey.values()]
}

/**
 * Events for the instruments a user actually cares about.
 *
 * Held positions first, then the watchlist, then nothing else — a calendar of every listed company
 * is a news feed, and this is not one. The ordering is the whole feature: what matters is not that
 * an event exists but that it is attached to something the reader owns.
 */
export function relevantEvents(
  events: readonly CorporateEvent[],
  held: ReadonlySet<string>,
  watched: ReadonlySet<string>,
  now: Date,
  limit = 12,
): Array<CorporateEvent & { relation: "HELD" | "WATCHED" }> {
  type Relevant = CorporateEvent & { relation: "HELD" | "WATCHED" }

  return upcoming(events, now, 200)
    .flatMap<Relevant>((event) => {
      const key = `${event.market}:${event.symbol}`
      if (held.has(key)) return [{ ...event, relation: "HELD" }]
      if (watched.has(key)) return [{ ...event, relation: "WATCHED" }]
      return []
    })
    .sort((a, b) => {
      // A held position outranks a watched one on the same day.
      if (a.relation !== b.relation) return a.relation === "HELD" ? -1 : 1
      return (a.date ?? "").localeCompare(b.date ?? "")
    })
    .slice(0, limit)
}

/**
 * A sentence for a notification or a list row.
 *
 * **Carries no portfolio figure.** A push notification can be read from a lock screen, so it may
 * say that AAPL has an earnings event and must never say what the reader's AAPL position is worth —
 * the same rule phase 5 applied to price alerts.
 */
export function describeEvent(event: CorporateEvent): string {
  const when = event.date === null ? "on a date not yet announced" : `on ${event.date}`
  const qualifier = event.estimated ? " (estimated)" : ""

  switch (event.type) {
    case "EARNINGS":
      return `${event.symbol} is scheduled to report earnings ${when}${qualifier}.`
    case "EX_DIVIDEND":
      return `${event.symbol} goes ex-dividend ${when}${qualifier}.`
    case "DIVIDEND":
      return event.amountPerShare !== null
        ? `${event.symbol} pays a dividend of ${event.amountPerShare} ${event.currency ?? ""} per share ${when}${qualifier}.`.replace("  ", " ")
        : `${event.symbol} has a dividend payment ${when}${qualifier}.`
    case "SPLIT":
    case "REVERSE_SPLIT":
      return event.ratio !== null
        ? `${event.symbol} has a ${event.ratio} ${EVENT_LABELS[event.type].toLowerCase()} ${when}${qualifier}.`
        : `${event.symbol} has a ${EVENT_LABELS[event.type].toLowerCase()} ${when}${qualifier}.`
    default:
      return `${event.symbol} has ${EVENT_LABELS[event.type].toLowerCase()} ${when}${qualifier}.`
  }
}

// ---------------------------------------------------------------- dividend fundamentals

export type DividendFundamentals = {
  /** Trailing twelve-month dividends per share, from recorded events. */
  trailingPerShare: number | null
  /** Payments in the last year. A frequency, not a promise of the next one. */
  paymentsPerYear: number | null
  /** Growth against the prior twelve months. Null when there is no prior year to compare. */
  growthPct: number | null
  /**
   * Dividends as a proportion of earnings.
   *
   * Null when earnings are not positive: a company paying a dividend out of losses has a payout
   * ratio that is either negative or enormous, and neither number means what a reader would take it
   * to mean.
   */
  payoutRatio: number | null
}

/**
 * Dividend fundamentals from a company's own payment history.
 *
 * Distinct from the *user's* dividend records, which are what the portfolio engine reads. This
 * describes what the company paid; that describes what the user received, and they can legitimately
 * differ — a user who bought mid-year received fewer payments than the company made.
 */
export function dividendFundamentals(
  payments: readonly { date: string; amountPerShare: number }[],
  earningsPerShare: number | null,
  now: Date,
): DividendFundamentals {
  const today = now.toISOString().slice(0, 10)
  const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString().slice(0, 10)
  const twoYearsAgo = new Date(now.getTime() - 730 * 86_400_000).toISOString().slice(0, 10)

  const recent = payments.filter((p) => p.date > yearAgo && p.date <= today)
  const prior = payments.filter((p) => p.date > twoYearsAgo && p.date <= yearAgo)

  const trailingPerShare =
    recent.length > 0 ? recent.reduce((total, p) => total + p.amountPerShare, 0) : null
  const priorPerShare =
    prior.length > 0 ? prior.reduce((total, p) => total + p.amountPerShare, 0) : null

  return {
    trailingPerShare,
    paymentsPerYear: recent.length > 0 ? recent.length : null,
    // Null rather than 0 when there is no prior year: a company's first dividend is not infinite
    // growth, and it is not zero growth either.
    growthPct:
      trailingPerShare === null || priorPerShare === null || priorPerShare <= 0
        ? null
        : ((trailingPerShare - priorPerShare) / priorPerShare) * 100,
    payoutRatio:
      trailingPerShare === null || earningsPerShare === null || earningsPerShare <= 0
        ? null
        : (trailingPerShare / earningsPerShare) * 100,
  }
}
