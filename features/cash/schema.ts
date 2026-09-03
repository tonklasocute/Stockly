import { z } from "zod"
import { CASH_FLOW_KINDS } from "@/domain/cash"
import { CURRENCIES } from "@/domain/market"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function tomorrowUtc(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export const cashInputSchema = z.object({
  portfolioId: z.uuid("Choose a portfolio."),
  /**
   * The full ledger. Direction is carried by `kind` — see `CASH_FLOW_DIRECTION` — so the amount
   * is always positive and one movement has exactly one spelling.
   */
  kind: z.enum(CASH_FLOW_KINDS, { message: "Choose what kind of movement this is." }),
  amount: z.coerce.number<number>().positive("Amount must be greater than 0.").finite(),
  /**
   * Genuinely independent of any market: one portfolio can hold a dollar balance and a baht balance
   * at the same time, so this is stored rather than derived. Defaults to the portfolio's base
   * currency at the call site.
   */
  currency: z.enum(CURRENCIES).optional(),
  occurredOn: z
    .string()
    .regex(ISO_DATE, "Use a valid date.")
    .refine((d) => d <= tomorrowUtc(), "The date cannot be in the future."),
  notes: z.string().trim().max(500, "Keep notes under 500 characters.").optional(),
})

export type CashFormValues = z.input<typeof cashInputSchema>
export type CashInput = z.output<typeof cashInputSchema>

export const cashUpdateSchema = cashInputSchema.omit({ portfolioId: true })
