import { z } from "zod"
import { CURRENCIES, MARKETS } from "@/domain/market"
import { RECONCILIATION_SCOPES } from "@/domain/reconciliation"

/**
 * The wire format for phase 19.
 *
 * Two shapes recur and are worth naming up front:
 *
 *   **A reconciliation request carries a reading, never an instruction.** It says what a statement
 *   reported. Nothing in it names a transaction to change, because deciding that is the user's and
 *   happens later, one difference at a time.
 *
 *   **Anything that changes money carries a reason.** A correction, a transfer and an adjustment
 *   all require one, and the database requires it too — a financial change nobody can explain is
 *   the thing an audit trail exists to prevent, so it is refused at both ends.
 */

const REASON = z
  .string()
  .trim()
  .min(3, "Say briefly why, so the audit trail explains itself.")
  .max(500, "Keep the reason under 500 characters.")

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const dateString = z.string().regex(ISO_DATE, "Use a valid date.")

/** A statement is a page of holdings, not a database. Beyond this it needs splitting. */
export const MAX_STATEMENT_POSITIONS = 500
export const MAX_STATEMENT_BALANCES = CURRENCIES.length

export const brokerPositionSchema = z.object({
  symbol: z.string().trim().min(1).max(20).transform((s) => s.toUpperCase()),
  market: z.enum(MARKETS),
  quantity: z.coerce.number<number>().finite().nonnegative(),
  /**
   * Null when the statement does not report one — and it must stay null. A zero here would report
   * every position without a stated cost as a 100% discrepancy.
   */
  averageCost: z.coerce.number<number>().finite().nonnegative().nullable().default(null),
  currency: z.enum(CURRENCIES),
})

export const brokerBalanceSchema = z.object({
  currency: z.enum(CURRENCIES),
  // A broker balance can genuinely be negative — a margin or settlement debit.
  balance: z.coerce.number<number>().finite(),
})

export const reconciliationRequestSchema = z
  .object({
    portfolioId: z.uuid("Choose a portfolio."),
    sourceLabel: z
      .string()
      .trim()
      .min(1, "Name the statement, so a past run can be told from another.")
      .max(120),
    periodStart: dateString.nullable().default(null),
    periodEnd: dateString.nullable().default(null),
    positions: z.array(brokerPositionSchema).max(MAX_STATEMENT_POSITIONS).default([]),
    balances: z.array(brokerBalanceSchema).max(MAX_STATEMENT_BALANCES).default([]),
  })
  .refine(
    (value) => value.periodStart === null || value.periodEnd === null || value.periodStart <= value.periodEnd,
    { message: "The period starts after it ends.", path: ["periodEnd"] },
  )
  .refine((value) => value.positions.length > 0 || value.balances.length > 0, {
    message: "Add at least one position or balance to compare against.",
    path: ["positions"],
  })
  // One currency cannot hold two balances; the second would silently win.
  .refine((value) => new Set(value.balances.map((b) => b.currency)).size === value.balances.length, {
    message: "Each currency can only have one balance.",
    path: ["balances"],
  })

export type ReconciliationRequest = z.output<typeof reconciliationRequestSchema>

export const resolveItemSchema = z.object({
  itemId: z.uuid(),
  /**
   * What the user did about it. `EXPLAINED` is deliberately available: most differences on a real
   * statement are settlement timing, and forcing every one to be "adjusted" or "ignored" would push
   * people toward creating adjustments that correct nothing.
   */
  resolution: z.enum(["ADJUSTED", "IGNORED", "EXPLAINED"]),
})

// ---------------------------------------------------------------- share adjustments

export const shareAdjustmentSchema = z
  .object({
    portfolioId: z.uuid("Choose a portfolio."),
    symbol: z.string().trim().min(1).max(20).transform((s) => s.toUpperCase()),
    market: z.enum(MARKETS),
    effectiveDate: dateString,
    numerator: z.coerce.number<number>().positive("The ratio cannot be zero.").finite(),
    denominator: z.coerce.number<number>().positive("The ratio cannot be zero.").finite(),
    corporateEventId: z.uuid().nullable().default(null),
    note: z.string().trim().max(500).optional(),
  })
  .refine((value) => value.numerator !== value.denominator, {
    message: "A 1:1 ratio changes nothing.",
    path: ["numerator"],
  })

export type ShareAdjustmentInput = z.output<typeof shareAdjustmentSchema>

// ---------------------------------------------------------------- correction

export const correctionSchema = z.object({
  symbol: z.string().trim().min(1).max(20).transform((s) => s.toUpperCase()),
  market: z.enum(MARKETS),
  side: z.enum(["buy", "sell"]),
  tradeDate: dateString,
  quantity: z.coerce.number<number>().positive().finite(),
  price: z.coerce.number<number>().nonnegative().finite(),
  fee: z.coerce.number<number>().nonnegative().finite().default(0),
  notes: z.string().trim().max(500).nullable().default(null),
  reason: REASON,
})

export type CorrectionInput = z.output<typeof correctionSchema>

// ---------------------------------------------------------------- transfer

export const transferSchema = z
  .object({
    fromPortfolioId: z.uuid("Choose the portfolio to move from."),
    toPortfolioId: z.uuid("Choose the portfolio to move to."),
    /**
     * Null moves everything. A transfer moves an instrument's **whole** history or none of it:
     * splitting one weighted-average cost basis across two portfolios would leave both wrong.
     */
    symbol: z.string().trim().min(1).max(20).transform((s) => s.toUpperCase()).nullable().default(null),
    market: z.enum(MARKETS).nullable().default(null),
    reason: REASON,
    /** False previews and writes nothing. The preview is the same computation as the apply. */
    apply: z.boolean().default(false),
  })
  .refine((value) => value.fromPortfolioId !== value.toPortfolioId, {
    message: "Choose two different portfolios.",
    path: ["toPortfolioId"],
  })
  .refine((value) => (value.symbol === null) === (value.market === null), {
    message: "A symbol needs its market — the same letters are two instruments on two venues.",
    path: ["market"],
  })

export type TransferInput = z.output<typeof transferSchema>

export const auditQuerySchema = z.object({
  entityId: z.uuid().optional(),
  portfolioId: z.uuid().optional(),
})

export const SCOPES = RECONCILIATION_SCOPES
