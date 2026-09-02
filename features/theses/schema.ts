import { z } from "zod"
import { MARKETS, normalizeSymbol } from "@/domain/market"
import { MAX_CONVICTION, MIN_CONVICTION, THESIS_STATUSES } from "@/domain/research"

const longText = (max = 4000) => z.string().trim().max(max).default("")

/**
 * An investment thesis.
 *
 * `status` is present on create and on update, and in both cases it is **whatever the user chose**.
 * Nothing on the server derives it, and no background job changes it — a system that decided a
 * thesis had failed would be issuing a sell recommendation with extra steps.
 */
export const thesisInputSchema = z.object({
  portfolioId: z.uuid("Choose a portfolio."),
  symbol: z
    .string()
    .transform(normalizeSymbol)
    .refine((s) => s.length > 0, "Symbol is required."),
  market: z.enum(MARKETS).default("US"),
  title: z
    .string()
    .trim()
    .min(1, "Give the thesis a title.")
    .max(140, "Keep the title under 140 characters."),
  whyBought: longText(),
  expectations: longText(),
  catalysts: longText(),
  risks: longText(),
  /** What the user decided in advance would change their mind. The field that makes it reviewable. */
  invalidationCriteria: longText(),
  conviction: z.coerce
    .number<number>()
    .int("Conviction is a whole number.")
    .min(MIN_CONVICTION, `Conviction runs from ${MIN_CONVICTION} to ${MAX_CONVICTION}.`)
    .max(MAX_CONVICTION, `Conviction runs from ${MIN_CONVICTION} to ${MAX_CONVICTION}.`)
    .default(5),
  status: z.enum(THESIS_STATUSES).default("ACTIVE"),
})

export type ThesisFormValues = z.input<typeof thesisInputSchema>
export type ThesisInput = z.output<typeof thesisInputSchema>

/** An edit cannot move a thesis to another portfolio or another instrument. */
export const thesisUpdateSchema = thesisInputSchema.omit({
  portfolioId: true,
  symbol: true,
  market: true,
})

/** Changing only the status — the one-tap action from the position page. */
export const thesisStatusSchema = z.object({ status: z.enum(THESIS_STATUSES) })
