import { z } from "zod"
import { SCREENER_METRICS, SCREENER_OPERATORS } from "@/domain/screener"

/**
 * The wire format for a screen.
 *
 * Everything is a closed enum. There is no field a client can put an expression, a query fragment
 * or a function name into — a filter is three constrained values, and anything else is rejected
 * before it reaches the engine.
 */
export const screenerFilterSchema = z.object({
  metric: z.enum(SCREENER_METRICS),
  operator: z.enum(SCREENER_OPERATORS),
  // A number, or one of the three trend names. Nothing else is representable.
  value: z.union([
    z.coerce.number<number>().finite("Enter a number.").min(-1e12).max(1e15),
    z.enum(["bullish", "bearish", "neutral"]),
  ]),
})

export const screenerDefinitionSchema = z.object({
  logic: z.enum(["AND", "OR"]).default("AND"),
  // Capped: a screen is a handful of conditions, and an unbounded array is an easy way to make the
  // server do arbitrary work.
  filters: z.array(screenerFilterSchema).max(10, "A screen can have at most 10 filters."),
  sort: z
    .object({
      metric: z.enum(SCREENER_METRICS),
      direction: z.enum(["asc", "desc"]).default("desc"),
    })
    .optional(),
})

export type ScreenerDefinitionInput = z.output<typeof screenerDefinitionSchema>

export const screenerRunSchema = z.object({
  definition: screenerDefinitionSchema,
  page: z.coerce.number<number>().int().min(1).max(200).default(1),
})

export const savedScreenSchema = z.object({
  name: z.string().trim().min(1, "Give the screen a name.").max(60, "Keep the name under 60 characters."),
  definition: screenerDefinitionSchema,
})
