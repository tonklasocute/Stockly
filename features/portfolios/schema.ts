import { z } from "zod"
import { CURRENCIES } from "@/domain/market"

export const portfolioInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the portfolio a name.")
    .max(60, "Keep the name under 60 characters."),
  /**
   * The portfolio's **base currency**: the one every total, chart and summary on its pages is
   * denominated in. Holdings keep their own currency; this is only what they are translated into.
   *
   * A closed enum rather than any three letters — the app has to be able to price it, and a code it
   * cannot get a rate for would render every total as "N/A" with no explanation.
   */
  currency: z.enum(CURRENCIES).default("USD"),
})

export type PortfolioFormValues = z.input<typeof portfolioInputSchema>
export type PortfolioInput = z.output<typeof portfolioInputSchema>

export { CURRENCIES } from "@/domain/market"
