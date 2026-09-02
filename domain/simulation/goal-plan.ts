/**
 * Goal planning: where a scenario lands against a target, and what it would take to close the gap.
 *
 * Built on the phase 10 goal model rather than beside it — the target, its currency and what the
 * type actually measures all come from `domain/goals.ts`, so a plan can never be measured against a
 * different definition than the progress bar next to it.
 *
 * The vocabulary is load-bearing. This module produces a **projected gap**, never "you will miss
 * your goal": one is arithmetic on an assumption the user chose, the other is a claim about the
 * future, and the difference is the whole reason the phase brief spells it out.
 */
import { percentOf, quantize } from "../money"
import { futureValue, periodicRate, simulateGrowth } from "./growth"
import {
  PERIODS_PER_YEAR,
  SCENARIO_RETURNS,
  SCENARIOS,
  failed,
  ok,
  type ContributionFrequency,
  type ContributionTiming,
  type GrowthResult,
  type GrowthScenario,
  type ScenarioName,
  type Simulated,
} from "./types"

export type GoalPlanInput = {
  /** Where the portfolio stands today, in the goal's unit. */
  currentValue: number
  /** The goal's target, in the same unit. */
  targetValue: number
  contribution: number
  frequency: ContributionFrequency
  timing: ContributionTiming
  annualReturn: number
  years: number
  contributionGrowth: number
  inflationRate: number | null
  currency: GrowthScenario["currency"]
}

export type GoalPlan = {
  growth: GrowthResult
  targetValue: number
  /** What the scenario lands on at the horizon. */
  projectedValue: number
  /**
   * Target minus projected value, floored at 0.
   *
   * Called a *projected* gap everywhere it is shown. It is what this arithmetic produces under this
   * assumption, not a shortfall anyone is heading for.
   */
  projectedGap: number
  /** Projected value as a percentage of the target. Uncapped: passing a target is worth seeing. */
  projectedProgressPct: number | null
  /** The first period end whose value reaches the target. Null if it does not within the horizon. */
  reachesTargetOn: string | null
  /** True when the portfolio is already at or above the target before any of this runs. */
  alreadyReached: boolean
}

/** Runs one scenario against one target. */
export function planGoal(
  input: GoalPlanInput,
  options: { from?: Date } = {},
): Simulated<GoalPlan> {
  if (!Number.isFinite(input.targetValue) || input.targetValue <= 0) {
    return failed("TARGET_UNREACHABLE")
  }

  const growth = simulateGrowth(
    {
      initialValue: input.currentValue,
      contribution: input.contribution,
      frequency: input.frequency,
      timing: input.timing,
      annualReturn: input.annualReturn,
      years: input.years,
      contributionGrowth: input.contributionGrowth,
      inflationRate: input.inflationRate,
      currency: input.currency,
    },
    options,
  )
  if (!growth.ok) return growth

  const projectedValue = growth.value.finalValue
  const reached = growth.value.points.find((point) => point.value >= input.targetValue)

  return ok({
    growth: growth.value,
    targetValue: input.targetValue,
    projectedValue,
    projectedGap: projectedValue >= input.targetValue ? 0 : quantize(input.targetValue - projectedValue),
    projectedProgressPct: percentOf(projectedValue, input.targetValue),
    // A portfolio already at the target reaches it at period zero, which is worth saying rather
    // than reporting the first modelled period as the moment it happened.
    reachesTargetOn: input.currentValue >= input.targetValue ? null : (reached?.date ?? null),
    alreadyReached: input.currentValue >= input.targetValue,
  })
}

/**
 * How much would have to be paid in each period to land exactly on the target.
 *
 * The annuity formula inverted:
 *
 *     C = (FV − P(1+r)ⁿ) / ( [((1+r)ⁿ − 1) / r] × timing )
 *     C = (FV − P) / n                                       when r = 0
 *
 * Returns **0** when the target is already covered — by the current value, or by growth alone — and
 * that is a real answer, not a missing one: nothing further needs to be paid in under this
 * assumption. Null only when the arithmetic cannot produce a figure at all: a non-positive horizon,
 * or a scenario so negative that no finite contribution reaches the target.
 */
export function requiredContribution({
  currentValue,
  targetValue,
  annualReturn,
  years,
  frequency,
  timing = "END",
}: {
  currentValue: number
  targetValue: number
  annualReturn: number
  years: number
  frequency: ContributionFrequency
  timing?: ContributionTiming
}): Simulated<number> {
  if (!Number.isFinite(currentValue) || currentValue < 0) return failed("INVALID_INITIAL_VALUE")
  if (!Number.isFinite(targetValue) || targetValue <= 0) return failed("TARGET_UNREACHABLE")
  if (!Number.isFinite(years) || years <= 0) return failed("INVALID_DURATION")
  if (!Number.isFinite(annualReturn) || annualReturn < -1) return failed("INVALID_RETURN")

  const periodsPerYear = PERIODS_PER_YEAR[frequency]
  const periods = Math.round(years * periodsPerYear)
  if (periods <= 0) return failed("INVALID_DURATION")

  const r = periodicRate(annualReturn, periodsPerYear)
  // What the money already invested grows to on its own, before anything is added.
  const grown = futureValue({ initial: currentValue, contribution: 0, periodicRate: r, periods })
  if (!Number.isFinite(grown)) return failed("INVALID_RETURN")

  // Already there without paying in another cent. Zero is the answer, not "unavailable".
  if (grown >= targetValue) return ok(0)

  const shortfall = targetValue - grown
  const annuityFactor =
    r === 0 ? periods : (((1 + r) ** periods - 1) / r) * (timing === "BEGIN" ? 1 + r : 1)

  // A non-positive factor would mean contributions cannot accumulate at all. It is not reachable
  // from the validated inputs — at exactly −100% the factor is 1, because every period wipes out
  // everything before it and the final payment is the whole balance — but the guard stays: an
  // unreachable branch is cheaper than a division that produces Infinity on a page.
  if (!Number.isFinite(annuityFactor) || annuityFactor <= 0) return failed("TARGET_UNREACHABLE")

  return ok(quantize(shortfall / annuityFactor))
}

export type ScenarioRow = {
  name: ScenarioName
  annualReturn: number
  contribution: number
  projectedValue: number | null
  projectedGap: number | null
  requiredContribution: number | null
  reachesTargetOn: string | null
}

/**
 * The same goal under each named scenario, for a side-by-side table.
 *
 * Every cell comes from the engine above; nothing in a UI recomputes one. A row whose scenario
 * cannot be modelled carries nulls rather than being dropped — a missing row would read as an
 * option that does not exist, when it is an option whose arithmetic failed.
 */
export function scenarioMatrix(
  input: Omit<GoalPlanInput, "annualReturn">,
  {
    returns = SCENARIO_RETURNS,
    from,
  }: { returns?: Record<ScenarioName, number>; from?: Date } = {},
): ScenarioRow[] {
  return SCENARIOS.map((name) => {
    const annualReturn = returns[name]
    const plan = planGoal({ ...input, annualReturn }, { from })
    const required = requiredContribution({
      currentValue: input.currentValue,
      targetValue: input.targetValue,
      annualReturn,
      years: input.years,
      frequency: input.frequency,
      timing: input.timing,
    })

    return {
      name,
      annualReturn,
      contribution: input.contribution,
      projectedValue: plan.ok ? plan.value.projectedValue : null,
      projectedGap: plan.ok ? plan.value.projectedGap : null,
      requiredContribution: required.ok ? required.value : null,
      reachesTargetOn: plan.ok ? plan.value.reachesTargetOn : null,
    }
  })
}

/**
 * The years left until a target date, as a fraction.
 *
 * Null for a date in the past or today: a horizon of zero has no scenario to run, and rounding it
 * up to "one year" would invent the time the user does not have.
 */
export function yearsUntil(targetDate: string | null, now: Date): number | null {
  if (!targetDate) return null
  const at = Date.parse(`${targetDate.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(at)) return null
  const years = (at - now.getTime()) / (365.25 * 86_400_000)
  return years > 0 ? quantize(years, 1_000_000) : null
}
