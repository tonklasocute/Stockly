import { z } from "zod"
import { MARKETS, normalizeSymbol } from "@/domain/market"

export const watchlistInputSchema = z.object({
  symbol: z
    .string()
    .transform(normalizeSymbol)
    .refine((s) => s.length > 0, "Symbol is required."),
  market: z.enum(MARKETS).default("US"),
  name: z.string().trim().max(120).optional(),
  exchange: z.string().trim().max(40).optional(),
  targetPrice: z.coerce
    .number<number>()
    .positive("Target price must be greater than 0.")
    .finite()
    .optional(),
  notes: z.string().trim().max(500, "Keep notes under 500 characters.").optional(),
})

export type WatchlistFormValues = z.input<typeof watchlistInputSchema>
export type WatchlistInput = z.output<typeof watchlistInputSchema>
