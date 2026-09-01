import { z } from "zod"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function tomorrowUtc(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export const cashInputSchema = z.object({
  portfolioId: z.uuid("Choose a portfolio."),
  kind: z.enum(["deposit", "withdrawal"], { message: "Choose deposit or withdrawal." }),
  // Direction is carried by `kind`, so the amount is always positive.
  amount: z.coerce.number<number>().positive("Amount must be greater than 0.").finite(),
  occurredOn: z
    .string()
    .regex(ISO_DATE, "Use a valid date.")
    .refine((d) => d <= tomorrowUtc(), "The date cannot be in the future."),
  notes: z.string().trim().max(500, "Keep notes under 500 characters.").optional(),
})

export type CashFormValues = z.input<typeof cashInputSchema>
export type CashInput = z.output<typeof cashInputSchema>

export const cashUpdateSchema = cashInputSchema.omit({ portfolioId: true })
