import { z } from "zod"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** Tomorrow in UTC — allows for the user's timezone being ahead of the server's. */
function latestAllowedTradeDate(): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export const transactionInputSchema = z.object({
  portfolioId: z.uuid("Choose a portfolio."),
  symbol: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, "Symbol is required.")
    .max(20, "Symbol is too long.")
    .regex(/^[A-Z0-9.\-&]+$/, "Symbols use letters, digits, '.', '-' and '&' only."),
  side: z.enum(["buy", "sell"], { message: "Choose buy or sell." }),
  tradeDate: z
    .string()
    .regex(ISO_DATE, "Use a valid date.")
    .refine((d) => d <= latestAllowedTradeDate(), "The trade date cannot be in the future."),
  quantity: z.coerce
    .number<number>()
    .positive("Quantity must be greater than 0.")
    .finite("Quantity must be a number."),
  price: z.coerce
    .number<number>()
    .min(0, "Price cannot be negative.")
    .finite("Price must be a number."),
  fee: z.coerce
    .number<number>()
    .min(0, "Fee cannot be negative.")
    .finite("Fee must be a number.")
    .default(0),
  notes: z.string().trim().max(500, "Keep notes under 500 characters.").optional(),
})

/** What the form holds (defaults not yet applied) vs. what the API receives. */
export type TransactionFormValues = z.input<typeof transactionInputSchema>
export type TransactionInput = z.output<typeof transactionInputSchema>

/** Edits carry the same fields; the portfolio a transaction belongs to is fixed. */
export const transactionUpdateSchema = transactionInputSchema.omit({ portfolioId: true })
export type TransactionUpdate = z.output<typeof transactionUpdateSchema>
