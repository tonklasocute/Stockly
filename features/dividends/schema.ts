import { z } from "zod"
import { normalizeSymbol } from "@/lib/symbol"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function tomorrowUtc(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export const dividendInputSchema = z.object({
  portfolioId: z.uuid("Choose a portfolio."),
  symbol: z
    .string()
    .transform(normalizeSymbol)
    .refine((s) => s.length > 0, "Symbol is required."),
  paymentDate: z
    .string()
    .regex(ISO_DATE, "Use a valid date.")
    .refine((d) => d <= tomorrowUtc(), "The payment date cannot be in the future."),
  shares: z.coerce.number<number>().positive("Shares must be greater than 0.").finite(),
  dividendPerShare: z.coerce
    .number<number>()
    .min(0, "Dividend per share cannot be negative.")
    .finite(),
  tax: z.coerce.number<number>().min(0, "Tax cannot be negative.").finite().default(0),
  fee: z.coerce.number<number>().min(0, "Fee cannot be negative.").finite().default(0),
  notes: z.string().trim().max(500, "Keep notes under 500 characters.").optional(),
})

export type DividendFormValues = z.input<typeof dividendInputSchema>
export type DividendInput = z.output<typeof dividendInputSchema>

export const dividendUpdateSchema = dividendInputSchema.omit({ portfolioId: true })
