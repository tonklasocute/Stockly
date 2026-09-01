import { z } from "zod"

export const portfolioInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the portfolio a name.")
    .max(60, "Keep the name under 60 characters."),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter currency code, e.g. USD.")
    .default("USD"),
})

export type PortfolioFormValues = z.input<typeof portfolioInputSchema>
export type PortfolioInput = z.output<typeof portfolioInputSchema>

export const CURRENCIES = ["USD", "THB", "EUR", "GBP", "JPY", "SGD"] as const
