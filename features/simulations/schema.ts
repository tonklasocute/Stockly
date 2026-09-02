import { z } from "zod"
import { CURRENCIES, MARKETS, normalizeSymbol } from "@/domain/market"
import {
  CONTRIBUTION_FREQUENCIES,
  MAX_ANNUAL_RETURN,
  MAX_YEARS,
  MIN_ANNUAL_RETURN,
  SCENARIOS,
} from "@/domain/simulation"

export const SIMULATION_TYPES = ["COMPOUND_GROWTH", "DCA", "GOAL", "DIVIDEND", "WHAT_IF"] as const
export type SimulationType = (typeof SIMULATION_TYPES)[number]

export const SIMULATION_LABELS: Record<SimulationType, string> = {
  COMPOUND_GROWTH: "Compound growth",
  DCA: "Regular investing",
  GOAL: "Goal planning",
  DIVIDEND: "Dividend projection",
  WHAT_IF: "Portfolio what-if",
}

/**
 * Rates on the wire are **percentages**, matching what the user typed, and are converted to decimal
 * fractions once at the engine boundary. A number that is sometimes 8 and sometimes 0.08 is the
 * arithmetic bug that survives every review, so the two forms never meet in the middle.
 */
const percentRate = (min: number, max: number) =>
  z.coerce.number<number>().finite("Enter a number.").min(min).max(max)

/** Shared by every scenario type: what is there, what goes in, at what rate, for how long. */
export const growthInputSchema = z.object({
  initialValue: z.coerce.number<number>().min(0, "Cannot be negative.").finite().max(1e15),
  contribution: z.coerce.number<number>().min(0, "Cannot be negative.").finite().max(1e12),
  frequency: z.enum(CONTRIBUTION_FREQUENCIES).default("MONTHLY"),
  annualReturnPct: percentRate(MIN_ANNUAL_RETURN * 100, MAX_ANNUAL_RETURN * 100),
  years: z.coerce.number<number>().min(1, "At least one year.").max(MAX_YEARS).finite(),
  contributionGrowthPct: percentRate(-100, 100).default(0),
  /** Null means the question was not asked; every real-value output is then null too. */
  inflationPct: percentRate(-99, 100).nullable().default(null),
  currency: z.enum(CURRENCIES),
})

export const goalInputSchema = growthInputSchema.extend({
  targetValue: z.coerce.number<number>().positive("Set a target above 0.").finite().max(1e15),
})

export const dividendInputSchema = growthInputSchema.extend({
  annualYieldPct: percentRate(0, 100).nullable(),
  yieldGrowthPct: percentRate(-100, 100).default(0),
  reinvest: z.boolean().default(false),
  costBasis: z.coerce.number<number>().min(0).finite().max(1e15).nullable().default(null),
})

const priceAdjustmentSchema = z.object({
  symbol: z.string().transform(normalizeSymbol),
  market: z.enum(MARKETS),
  changePct: z.coerce.number<number>().finite().min(-100).max(1000).optional(),
  scenarioPrice: z.coerce.number<number>().finite().min(0).max(1e12).optional(),
})

const quantityAdjustmentSchema = z.object({
  symbol: z.string().transform(normalizeSymbol),
  market: z.enum(MARKETS),
  quantityDelta: z.coerce.number<number>().finite().min(-1e12).max(1e12).optional(),
  amountDelta: z.coerce.number<number>().finite().min(-1e12).max(1e12).optional(),
  reducePct: z.coerce.number<number>().finite().min(0).max(100).optional(),
})

export const whatIfInputSchema = z.object({
  cashDelta: z.coerce.number<number>().finite().min(-1e12).max(1e12).default(0),
  // Capped so one scenario cannot become an unbounded amount of server work, the same reasoning as
  // the screener's ten-filter limit.
  priceAdjustments: z.array(priceAdjustmentSchema).max(50).default([]),
  quantityAdjustments: z.array(quantityAdjustmentSchema).max(50).default([]),
  // Keyed by currency code, valued by units of the base currency per one of it. A partial record:
  // a scenario overrides the pairs the user cares about and leaves the rest at their real rates.
  fxOverrides: z
    .partialRecord(z.enum(CURRENCIES), z.coerce.number<number>().positive().finite())
    .default({}),
})

/**
 * A saved scenario.
 *
 * `inputs` is validated per type rather than as one permissive object: a saved DCA scenario with a
 * dividend yield in it would be a document nothing could read back consistently.
 */
export const savedSimulationSchema = z
  .object({
    portfolioId: z.uuid().nullable().default(null),
    name: z
      .string()
      .trim()
      .min(1, "Give the scenario a name.")
      .max(60, "Keep the name under 60 characters."),
    type: z.enum(SIMULATION_TYPES),
    inputs: z.unknown(),
  })
  .superRefine((value, ctx) => {
    const schema =
      value.type === "GOAL"
        ? goalInputSchema
        : value.type === "DIVIDEND"
          ? dividendInputSchema
          : value.type === "WHAT_IF"
            ? whatIfInputSchema
            : growthInputSchema

    if (!schema.safeParse(value.inputs).success) {
      ctx.addIssue({
        code: "custom",
        path: ["inputs"],
        message: `Those inputs are not a valid ${SIMULATION_LABELS[value.type]} scenario.`,
      })
    }
    // A portfolio-based scenario without a portfolio has nothing to start from.
    if (value.type === "WHAT_IF" && !value.portfolioId) {
      ctx.addIssue({
        code: "custom",
        path: ["portfolioId"],
        message: "A what-if scenario belongs to a portfolio.",
      })
    }
  })

export type SavedSimulationInput = z.output<typeof savedSimulationSchema>

export const savedSimulationUpdateSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  inputs: z.unknown().optional(),
})

/** A cap the database can answer, so a script cannot fill a table by looping. */
export const MAX_SAVED_SIMULATIONS = 50

export { SCENARIOS }
