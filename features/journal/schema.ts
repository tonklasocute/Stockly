import { z } from "zod"
import { MARKETS, normalizeSymbol } from "@/domain/market"
import { JOURNAL_TYPES, SELL_REASONS } from "@/domain/research"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function tomorrowUtc(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * A journal entry: the user's own words about a decision.
 *
 * `content` is stored and rendered as plain text — never parsed as markdown or HTML, and never
 * passed through a sanitiser, because there is nothing to sanitise if it is only ever a React text
 * node. That is the same rule the AI layer follows for model output, for the same reason.
 */
export const journalInputSchema = z
  .object({
    portfolioId: z.uuid("Choose a portfolio."),
    type: z.enum(JOURNAL_TYPES).default("GENERAL"),
    /** Optional: a market note belongs to no single instrument. */
    symbol: z
      .string()
      .transform(normalizeSymbol)
      .refine((s) => s.length === 0 || s.length > 0)
      .optional(),
    market: z.enum(MARKETS).default("US"),
    transactionId: z.uuid().optional(),
    /** Only meaningful on a sell review; rejected elsewhere by the refinement below. */
    reason: z.enum(SELL_REASONS).optional(),
    title: z
      .string()
      .trim()
      .min(1, "Give the entry a title.")
      .max(140, "Keep the title under 140 characters."),
    content: z.string().trim().max(10_000, "Keep the entry under 10,000 characters.").default(""),
    entryDate: z
      .string()
      .regex(ISO_DATE, "Use a valid date.")
      .refine((d) => d <= tomorrowUtc(), "The date cannot be in the future.")
      .default(() => new Date().toISOString().slice(0, 10)),
  })
  .superRefine((value, ctx) => {
    if (value.reason && value.type !== "SELL_REASON") {
      ctx.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A sell reason only applies to a sell review.",
      })
    }
    if (value.type === "SELL_REASON" && !value.reason) {
      ctx.addIssue({ code: "custom", path: ["reason"], message: "Choose why you sold." })
    }
    // The position page finds an entry by instrument; one pinned to a trade with no symbol would be
    // invisible there, and the database refuses it too.
    if (value.transactionId && !value.symbol) {
      ctx.addIssue({
        code: "custom",
        path: ["symbol"],
        message: "An entry attached to a transaction needs its symbol.",
      })
    }
  })

export type JournalFormValues = z.input<typeof journalInputSchema>
export type JournalInput = z.output<typeof journalInputSchema>

/** An edit cannot move an entry to another portfolio, or re-point it at another trade. */
export const journalUpdateSchema = z.object({
  type: z.enum(JOURNAL_TYPES).optional(),
  reason: z.enum(SELL_REASONS).nullable().optional(),
  title: z.string().trim().min(1, "Give the entry a title.").max(140).optional(),
  content: z.string().trim().max(10_000).optional(),
  entryDate: z
    .string()
    .regex(ISO_DATE, "Use a valid date.")
    .refine((d) => d <= tomorrowUtc(), "The date cannot be in the future.")
    .optional(),
})

/** Query-string filters for the timeline. Every one is optional and independently applied. */
export const journalFilterSchema = z.object({
  portfolioId: z.uuid(),
  type: z.enum(JOURNAL_TYPES).optional(),
  symbol: z.string().transform(normalizeSymbol).optional(),
  market: z.enum(MARKETS).optional(),
  from: z.string().regex(ISO_DATE).optional(),
  to: z.string().regex(ISO_DATE).optional(),
  q: z.string().trim().max(100).optional(),
})
