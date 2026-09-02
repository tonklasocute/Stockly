/**
 * Compound growth, and the DCA simulator built from it.
 *
 * They are one calculation, not two: dollar-cost averaging *is* compound growth with a periodic
 * contribution, and giving them separate implementations would be two places for the same formula
 * to be wrong differently. The UI presents them as two tools; the maths is here once.
 *
 * **Convention: contributions land at the END of each period**, which makes the recurring part an
 * ordinary annuity. `BEGIN` is implemented and tested because the difference is real — an
 * annuity-due earns one extra period on every payment — but nothing in Stockly passes it.
 *
 * Two implementations of the same thing, deliberately:
 *
 *   `futureValue`  — the closed form, for the solver in `goal-plan.ts` to invert.
 *   `simulateGrowth` — period by period, because a chart needs the series anyway, and because an
 *                      escalating contribution has no tidy closed form.
 *
 * A test asserts the two agree to nine decimal places wherever both apply. That is what stops the
 * cheap one and the exact one drifting apart.
 */
import { percentOf, quantize } from "../money"
import {
  MAX_ANNUAL_RETURN,
  MAX_YEARS,
  MIN_ANNUAL_RETURN,
  PERIODS_PER_YEAR,
  failed,
  ok,
  type ContributionTiming,
  type GrowthPoint,
  type GrowthResult,
  type GrowthScenario,
  type Simulated,
} from "./types"

export const GROWTH_METHOD =
  "Compounded once per contribution period at the periodic equivalent of the stated annual rate, " +
  "with contributions added at the end of each period. Taxes, fees, dividends and exchange-rate " +
  "movement are not modelled."

/**
 * The periodic rate equivalent to an annual one.
 *
 * Geometric, not annual ÷ periods: compounding twelve monthly rates must reproduce the annual
 * figure exactly, and dividing would quietly understate it — 8% ÷ 12 compounded twelve times is
 * 8.30%, so a ten-year projection would drift by thousands.
 *
 * At exactly −100% the base is 0 and the periodic rate is −1: every period wipes the balance out
 * and only the contributions since survive. That is well defined and is modelled. Below −100% the
 * base is negative and a fractional power is not a real number, which is why the caller rejects it.
 */
export function periodicRate(annualReturn: number, periodsPerYear: number): number {
  if (annualReturn === 0) return 0
  return (1 + annualReturn) ** (1 / periodsPerYear) - 1
}

/**
 * Future value of a lump sum plus a level annuity — the formula in the phase brief:
 *
 *     FV = P(1+r)ⁿ + C · [((1+r)ⁿ − 1) / r]        (contributions at period end)
 *     FV = P(1+r)ⁿ + C · [((1+r)ⁿ − 1) / r](1+r)   (contributions at period start)
 *
 * `r = 0` is handled separately rather than by the general expression, which would divide by zero:
 * with no return, the annuity is simply `C × n`.
 */
export function futureValue({
  initial,
  contribution,
  periodicRate: r,
  periods,
  timing = "END",
}: {
  initial: number
  contribution: number
  periodicRate: number
  periods: number
  timing?: ContributionTiming
}): number {
  if (periods <= 0) return initial

  if (r === 0) {
    // No growth: the balance is exactly what was paid in, whenever it was paid.
    return initial + contribution * periods
  }

  const compounded = (1 + r) ** periods
  const annuity = (compounded - 1) / r
  const due = timing === "BEGIN" ? 1 + r : 1
  return initial * compounded + contribution * annuity * due
}

/** Validation shared by every entry point, so an impossible input can never reach the arithmetic. */
function validate(scenario: GrowthScenario): Simulated<null> {
  if (!Number.isFinite(scenario.initialValue) || scenario.initialValue < 0) {
    return failed("INVALID_INITIAL_VALUE")
  }
  if (!Number.isFinite(scenario.contribution) || scenario.contribution < 0) {
    return failed("INVALID_CONTRIBUTION")
  }
  if (
    !Number.isFinite(scenario.annualReturn) ||
    scenario.annualReturn < MIN_ANNUAL_RETURN ||
    scenario.annualReturn > MAX_ANNUAL_RETURN
  ) {
    return failed("INVALID_RETURN")
  }
  if (!Number.isFinite(scenario.contributionGrowth) || Math.abs(scenario.contributionGrowth) > 1) {
    return failed("INVALID_CONTRIBUTION")
  }
  if (!Number.isFinite(scenario.years) || scenario.years <= 0 || scenario.years > MAX_YEARS) {
    return failed("INVALID_DURATION")
  }
  if (
    scenario.inflationRate !== null &&
    (!Number.isFinite(scenario.inflationRate) ||
      scenario.inflationRate <= -1 ||
      scenario.inflationRate > 1)
  ) {
    return failed("INVALID_INFLATION")
  }
  return ok(null)
}

/** The end of period `index`, counting from `from`. Dates are labels; the maths uses the index. */
function periodDate(from: Date, index: number, periodsPerYear: number): string {
  const monthsPerPeriod = 12 / periodsPerYear
  const at = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + Math.round(index * monthsPerPeriod), 1),
  )
  return at.toISOString().slice(0, 10)
}

/**
 * Runs a growth scenario period by period.
 *
 * Precision: the running balance is carried at full double precision and quantized only when it is
 * written into a point. Rounding the balance and feeding it back would compound the rounding error
 * along with the money — over 600 monthly periods that is a visible, and entirely invented,
 * difference.
 */
export function simulateGrowth(
  scenario: GrowthScenario,
  { from = new Date() }: { from?: Date } = {},
): Simulated<GrowthResult> {
  const invalid = validate(scenario)
  if (!invalid.ok) return invalid

  const periodsPerYear = PERIODS_PER_YEAR[scenario.frequency]
  const periods = Math.round(scenario.years * periodsPerYear)
  if (periods <= 0) return failed("INVALID_DURATION")

  const r = periodicRate(scenario.annualReturn, periodsPerYear)
  if (!Number.isFinite(r)) return failed("INVALID_RETURN")

  const points: GrowthPoint[] = []
  let value = scenario.initialValue
  let contributed = scenario.initialValue
  let contributionsOnly = 0

  for (let index = 1; index <= periods; index += 1) {
    // The contribution escalates once a year, not every period: a "5% annual raise" that compounded
    // monthly would be 79% over ten years instead of 63%.
    const yearsElapsed = Math.floor((index - 1) / periodsPerYear)
    const payment = scenario.contribution * (1 + scenario.contributionGrowth) ** yearsElapsed

    if (scenario.timing === "BEGIN") {
      value = (value + payment) * (1 + r)
    } else {
      value = value * (1 + r) + payment
    }
    contributed += payment
    contributionsOnly += payment

    if (!Number.isFinite(value)) return failed("INVALID_RETURN")

    const elapsedYears = index / periodsPerYear
    points.push({
      date: periodDate(from, index, periodsPerYear),
      periodIndex: index,
      contributed: quantize(contributed),
      growth: quantize(value - contributed),
      value: quantize(value),
      realValue:
        scenario.inflationRate === null
          ? null
          : quantize(value / (1 + scenario.inflationRate) ** elapsedYears),
    })
  }

  const totalInvested = scenario.initialValue + contributionsOnly

  return ok({
    scenario,
    points,
    finalValue: quantize(value),
    totalContributions: quantize(contributionsOnly),
    totalInvested: quantize(totalInvested),
    totalGrowth: quantize(value - totalInvested),
    growthPct: percentOf(value - totalInvested, totalInvested),
    finalRealValue:
      scenario.inflationRate === null
        ? null
        : quantize(value / (1 + scenario.inflationRate) ** scenario.years),
    method: GROWTH_METHOD,
  })
}

/**
 * The same scenario at several assumed returns, for a side-by-side comparison.
 *
 * Each result carries its own scenario, so a table cannot show a value under the wrong rate — the
 * assumption travels with the number it produced, everywhere in this codebase.
 */
export function compareReturns(
  scenario: GrowthScenario,
  annualReturns: readonly number[],
  options: { from?: Date } = {},
): Array<{ annualReturn: number; result: Simulated<GrowthResult> }> {
  return annualReturns.map((annualReturn) => ({
    annualReturn,
    result: simulateGrowth({ ...scenario, annualReturn }, options),
  }))
}

/**
 * A nominal amount restated in today's money.
 *
 *     real = nominal / (1 + inflation) ^ years
 *
 * Null when no inflation assumption was given: "we were not told" and "inflation is zero" are
 * different statements, and only the second is an assumption anyone should make on a user's behalf.
 */
export function realValue(
  nominal: number,
  inflationRate: number | null,
  years: number,
): number | null {
  if (inflationRate === null) return null
  if (!Number.isFinite(nominal) || !Number.isFinite(inflationRate) || inflationRate <= -1) return null
  if (!Number.isFinite(years) || years < 0) return null
  return quantize(nominal / (1 + inflationRate) ** years)
}

/**
 * The real (inflation-adjusted) equivalent of a nominal return.
 *
 *     real = (1 + nominal) / (1 + inflation) − 1
 *
 * The Fisher relation, not `nominal − inflation`: the subtraction is an approximation that drifts
 * as either rate grows, and at 8% against 3% it is already wrong by a tenth of a point. Null when
 * there is no inflation assumption, so a "real return" is never silently the nominal one.
 */
export function realReturn(nominalReturn: number, inflationRate: number | null): number | null {
  if (inflationRate === null) return null
  if (!Number.isFinite(nominalReturn) || !Number.isFinite(inflationRate)) return null
  if (inflationRate <= -1) return null
  return quantize((1 + nominalReturn) / (1 + inflationRate) - 1, 1_000_000_000)
}
