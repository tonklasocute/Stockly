import { z } from "zod"
import { CURRENCIES } from "@/domain/market"
import { GOAL_TYPES, PROJECTION_SCENARIOS } from "@/domain/goals"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A portfolio goal.
 *
 * The one rule the schema itself enforces: **a percentage target carries no currency, and a money
 * target must.** TOTAL_RETURN is a percentage — a currency on it would be meaningless — and the
 * other three are amounts that cannot be measured without knowing what they are amounts *of*. The
 * database has the same constraint, so the invariant survives anything that bypasses this schema.
 */
export const goalInputSchema = z
  .object({
    portfolioId: z.uuid("Choose a portfolio."),
    type: z.enum(GOAL_TYPES),
    targetValue: z.coerce
      .number<number>()
      .positive("Set a target above 0.")
      .finite("Enter a number."),
    currency: z.enum(CURRENCIES).optional(),
    targetDate: z
      .string()
      .regex(ISO_DATE, "Use a valid date.")
      .optional()
      .or(z.literal("").transform(() => undefined)),
    note: z.string().trim().max(500, "Keep the note under 500 characters.").optional(),
  })
  .superRefine((value, ctx) => {
    if (value.type === "TOTAL_RETURN") {
      if (value.currency) {
        ctx.addIssue({
          code: "custom",
          path: ["currency"],
          message: "A return target is a percentage and has no currency.",
        })
      }
      if (value.targetValue > 1000) {
        ctx.addIssue({
          code: "custom",
          path: ["targetValue"],
          message: "Enter a return target as a percentage, up to 1000.",
        })
      }
    } else if (!value.currency) {
      ctx.addIssue({ code: "custom", path: ["currency"], message: "Choose a currency." })
    }
  })

export type GoalFormValues = z.input<typeof goalInputSchema>
export type GoalInput = z.output<typeof goalInputSchema>

/** An edit cannot change a goal's type — that would silently reinterpret its target. */
export const goalUpdateSchema = z.object({
  targetValue: z.coerce.number<number>().positive().finite().optional(),
  currency: z.enum(CURRENCIES).nullable().optional(),
  targetDate: z
    .string()
    .regex(ISO_DATE)
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  note: z.string().trim().max(500).nullable().optional(),
})

/**
 * A projection request.
 *
 * Every assumption is an explicit input with no server-side default beyond the named scenario's
 * documented growth rate, so the number that comes back can always be traced to a figure the user
 * saw and could change.
 */
export const projectionSchema = z.object({
  scenario: z.enum(PROJECTION_SCENARIOS).default("BASE"),
  /** Annual growth as a percentage, so the wire format matches what the user typed. */
  annualGrowthPct: z.coerce.number<number>().min(-50).max(50).optional(),
  monthlyContribution: z.coerce.number<number>().min(0).max(1e9).default(0),
  horizonYears: z.coerce.number<number>().min(1).max(50).default(10),
})

export type ProjectionInput = z.output<typeof projectionSchema>
