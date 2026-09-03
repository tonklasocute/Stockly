/**
 * The user's own research record: investment theses, journal entries and sell reviews.
 *
 * All three answer questions no calculation can: *why did I buy this*, *what would change my mind*,
 * and *why did I sell*. They are the one part of Stockly whose content the system does not
 * generate, does not validate against reality, and does not act on.
 *
 * The rule that keeps it safe, stated once here and enforced by the absence of any import of this
 * module from the calculation engine: **nothing in this file may change a financial number.** A
 * thesis is a note, not an input. Deleting every thesis in a portfolio leaves its holdings, cost
 * basis and P&L byte-identical.
 *
 * The second rule concerns status. **Only the user marks a thesis broken.** The system may put a
 * fact beside it — "this position is 18% below its cost basis" — and it must stop there. A system
 * that decided a thesis had failed would be making a sell recommendation with extra steps.
 *
 * Pure: no clock beyond what is passed in, no database, no framework.
 */

// ---------------------------------------------------------------- journal

export const JOURNAL_TYPES = [
  "BUY_THESIS",
  "SELL_REASON",
  "POSITION_REVIEW",
  "MARKET_NOTE",
  "DIVIDEND_NOTE",
  "GENERAL",
] as const

export type JournalType = (typeof JOURNAL_TYPES)[number]

/*
 * The words for this enum live in the `enums` namespace, keyed by the same values, in every
 * language Stockly ships. A `Record<Enum, string>` of English here would be the copy the other
 * languages drift away from, and this module is the one that must hold no prose at all.
 */

// ---------------------------------------------------------------- sell review

export const SELL_REASONS = [
  "TARGET_REACHED",
  "THESIS_BROKEN",
  "RISK_INCREASED",
  "VALUATION",
  "PORTFOLIO_REBALANCE",
  "LIQUIDITY",
  "TAX",
  "OTHER",
] as const

export type SellReason = (typeof SELL_REASONS)[number]

/*
 * The words for this enum live in the `enums` namespace, keyed by the same values, in every
 * language Stockly ships. A `Record<Enum, string>` of English here would be the copy the other
 * languages drift away from, and this module is the one that must hold no prose at all.
 */

/**
 * A sell review records *why*. **It never records how much.**
 *
 * Realised profit and loss is computed by `domain/holdings.ts` from the transaction that closed the
 * position, and a user-entered figure beside it would be a second source of truth for the number
 * this entire application exists to get right. So a review carries a reason and a note, and the
 * result is looked up.
 */
export type SellReviewInput = {
  transactionId: string
  reason: SellReason
  notes?: string | null
}

// ---------------------------------------------------------------- thesis

export const THESIS_STATUSES = ["ACTIVE", "CONFIRMED", "QUESTIONED", "BROKEN", "CLOSED"] as const

export type ThesisStatus = (typeof THESIS_STATUSES)[number]

/*
 * The words for this enum live in the `enums` namespace, keyed by the same values, in every
 * language Stockly ships. A `Record<Enum, string>` of English here would be the copy the other
 * languages drift away from, and this module is the one that must hold no prose at all.
 */

/** Drives a badge. Never a judgement — "broken" is the user's word about their own reasoning. */
export const THESIS_STATUS_TONE: Record<ThesisStatus, "neutral" | "positive" | "caution" | "negative"> = {
  ACTIVE: "neutral",
  CONFIRMED: "positive",
  QUESTIONED: "caution",
  BROKEN: "negative",
  CLOSED: "neutral",
}

export const MIN_CONVICTION = 1
export const MAX_CONVICTION = 10

export function isValidConviction(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_CONVICTION && value <= MAX_CONVICTION
}

/**
 * How long since a thesis was last touched, in days. Null for an unparseable timestamp.
 *
 * Used only to *offer* a review — "you wrote this eleven months ago" — never to change a status.
 */
export function daysSinceReview(updatedAt: string, now: Date): number | null {
  const at = Date.parse(updatedAt)
  if (Number.isNaN(at)) return null
  return Math.max(0, Math.floor((now.getTime() - at) / 86_400_000))
}

/** A thesis older than this is worth re-reading. Not a deadline, and nothing expires. */
export const THESIS_REVIEW_AFTER_DAYS = 180

// ---------------------------------------------------------------- review prompts

/**
 * Facts that are worth putting in front of someone re-reading their own thesis.
 *
 * Every one is a measurement the user could look up themselves; none is a conclusion. The
 * difference matters more here than anywhere else in the codebase, because this is the exact point
 * at which a portfolio tracker could start telling people what to do.
 *
 *   Allowed:     "The position is 18.4% below its cost basis."
 *   Not allowed: "Your thesis looks broken." / "Consider selling."
 */
export type ThesisObservation = {
  code: "DRAWDOWN_FROM_COST" | "GAIN_FROM_COST" | "POSITION_CLOSED" | "STALE_REVIEW" | "WEIGHT_GREW"
  text: string
}

export type ThesisContext = {
  /** Return since purchase, percent. Null when the position has no cost basis. */
  returnPct: number | null
  /** Share of the portfolio today, percent. Null when it could not be computed. */
  weightPct: number | null
  /** Shares still held. 0 means the position is closed. */
  quantity: number
  updatedAt: string
}

/**
 * Observations to show beside a thesis. Descriptive, ordered, and never more than a handful — a
 * list long enough to feel like advice has already stopped being a list of facts.
 */
export function thesisObservations(
  context: ThesisContext,
  now: Date,
  { drawdownPct = 15, gainPct = 25, weightPct = 25 }: { drawdownPct?: number; gainPct?: number; weightPct?: number } = {},
): ThesisObservation[] {
  const out: ThesisObservation[] = []

  if (context.quantity === 0) {
    out.push({
      code: "POSITION_CLOSED",
      text: "This position is closed. The thesis is kept as a record of the reasoning at the time.",
    })
  }

  if (context.returnPct !== null && context.returnPct <= -drawdownPct) {
    out.push({
      code: "DRAWDOWN_FROM_COST",
      text: `The position is ${Math.abs(context.returnPct).toFixed(1)}% below its cost basis.`,
    })
  }

  if (context.returnPct !== null && context.returnPct >= gainPct) {
    out.push({
      code: "GAIN_FROM_COST",
      text: `The position is ${context.returnPct.toFixed(1)}% above its cost basis.`,
    })
  }

  if (context.weightPct !== null && context.weightPct >= weightPct) {
    out.push({
      code: "WEIGHT_GREW",
      text: `This position is ${context.weightPct.toFixed(1)}% of the portfolio.`,
    })
  }

  const age = daysSinceReview(context.updatedAt, now)
  if (age !== null && age >= THESIS_REVIEW_AFTER_DAYS) {
    out.push({
      code: "STALE_REVIEW",
      text: `Last updated ${age} days ago.`,
    })
  }

  return out
}
