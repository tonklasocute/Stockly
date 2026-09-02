/**
 * Dividend projection.
 *
 * The distinction this module exists to protect: **actual dividend income and projected dividend
 * income are different data.** One is a record of payments that arrived; the other is arithmetic on
 * two assumptions. They are separate fields, on separate rows, under separate headings, and nothing
 * here ever adds one to the other.
 *
 * Two yields, two names, as everywhere else in Stockly: yield on current value and yield on cost
 * share a numerator and nothing else, and neither is ever called just "dividend yield".
 */
import { percentOf, quantize } from "../money"
import { simulateGrowth } from "./growth"
import {
  PERIODS_PER_YEAR,
  failed,
  ok,
  type ContributionFrequency,
  type ContributionTiming,
  type GrowthScenario,
  type Simulated,
} from "./types"

export const DIVIDEND_METHOD =
  "Each year's income is the year-end portfolio value under the growth scenario multiplied by the " +
  "assumed yield, with the yield itself growing at the stated rate. Payment timing within the year " +
  "is not modelled, and neither is tax."

export const DRIP_METHOD =
  "With reinvestment on, each year's dividends are added to the portfolio at the end of that year " +
  "and compound with it thereafter. They are counted as growth, not as a contribution: the money " +
  "came from the portfolio, not from the investor."

export type DividendScenario = {
  /** Where the portfolio stands today. */
  initialValue: number
  contribution: number
  frequency: ContributionFrequency
  timing: ContributionTiming
  /** Assumed annual price return, excluding dividends. */
  annualReturn: number
  years: number
  contributionGrowth: number
  /**
   * Assumed yield on current value, as a decimal fraction.
   *
   * Null when the portfolio has no dividend history to base one on — the projection is then `null`
   * rather than a zero-income forecast, which would look like a claim that it pays nothing.
   */
  annualYield: number | null
  /** Assumed annual growth in the yield itself. 0 holds it flat. */
  yieldGrowth: number
  /** Whether dividends are added back to the portfolio at each year end. */
  reinvest: boolean
  /** Cost basis, for yield on cost. Null when unknown — the figure is then null too. */
  costBasis: number | null
  inflationRate: number | null
  currency: GrowthScenario["currency"]
}

export type DividendYear = {
  year: number
  date: string
  /** Portfolio value at the end of the year under the growth scenario. */
  portfolioValue: number
  /** The yield assumed for this year, after growth. */
  appliedYield: number
  projectedIncome: number
  cumulativeIncome: number
  /** Income ÷ that year's portfolio value. Restates the applied yield against the actual base. */
  yieldOnValuePct: number | null
  /** Income ÷ original cost basis. Null when the cost basis is unknown. */
  yieldOnCostPct: number | null
  /** Projected income in today's money. Null without an inflation assumption. */
  realIncome: number | null
}

export type DividendProjection = {
  scenario: DividendScenario
  years: DividendYear[]
  /** Income in the final modelled year. */
  finalAnnualIncome: number
  cumulativeIncome: number
  /** Final-year income divided by the first year's. Null when the first year produced nothing. */
  incomeGrowthPct: number | null
  method: string
}

/**
 * Projects dividend income year by year.
 *
 * `null` — not a zero-income projection — when there is no yield to assume. A portfolio with no
 * dividend history has an unknown future income, and reporting ฿0 a year would be a claim.
 */
export function projectDividends(
  scenario: DividendScenario,
  { from = new Date() }: { from?: Date } = {},
): Simulated<DividendProjection> {
  if (scenario.annualYield === null) return failed("INSUFFICIENT_HISTORY")
  if (!Number.isFinite(scenario.annualYield) || scenario.annualYield < 0 || scenario.annualYield > 1) {
    return failed("INSUFFICIENT_HISTORY")
  }
  if (!Number.isFinite(scenario.yieldGrowth) || Math.abs(scenario.yieldGrowth) > 1) {
    return failed("INSUFFICIENT_HISTORY")
  }

  const growth = simulateGrowth(
    {
      initialValue: scenario.initialValue,
      contribution: scenario.contribution,
      frequency: scenario.frequency,
      timing: scenario.timing,
      annualReturn: scenario.annualReturn,
      years: scenario.years,
      contributionGrowth: scenario.contributionGrowth,
      inflationRate: scenario.inflationRate,
      currency: scenario.currency,
    },
    { from },
  )
  if (!growth.ok) return growth

  const periodsPerYear = PERIODS_PER_YEAR[scenario.frequency]
  const wholeYears = Math.max(1, Math.floor(scenario.years))
  const years: DividendYear[] = []

  let cumulative = 0
  // Dividends that were reinvested and are now compounding on top of the growth scenario. Tracked
  // separately so the base portfolio series stays exactly what the growth simulator produced.
  let reinvested = 0

  for (let year = 1; year <= wholeYears; year += 1) {
    const point = growth.value.points[Math.min(year * periodsPerYear, growth.value.points.length) - 1]
    if (!point) break

    // Reinvested dividends grow at the same assumed rate as everything else.
    reinvested = reinvested * (1 + scenario.annualReturn)
    const portfolioValue = point.value + reinvested

    const appliedYield = scenario.annualYield * (1 + scenario.yieldGrowth) ** (year - 1)
    const income = portfolioValue * appliedYield
    if (!Number.isFinite(income)) return failed("INVALID_RETURN")

    cumulative += income
    if (scenario.reinvest) reinvested += income

    years.push({
      year,
      date: point.date,
      portfolioValue: quantize(portfolioValue),
      appliedYield: quantize(appliedYield, 1_000_000_000),
      projectedIncome: quantize(income),
      cumulativeIncome: quantize(cumulative),
      yieldOnValuePct: percentOf(income, portfolioValue),
      // Two different denominators, never conflated: yield on cost divides by what was paid.
      yieldOnCostPct:
        scenario.costBasis !== null && scenario.costBasis > 0
          ? percentOf(income, scenario.costBasis)
          : null,
      realIncome:
        scenario.inflationRate === null
          ? null
          : quantize(income / (1 + scenario.inflationRate) ** year),
    })
  }

  if (years.length === 0) return failed("INVALID_DURATION")

  const first = years[0].projectedIncome
  const last = years[years.length - 1].projectedIncome

  return ok({
    scenario,
    years,
    finalAnnualIncome: last,
    cumulativeIncome: quantize(cumulative),
    incomeGrowthPct: first > 0 ? percentOf(last - first, first) : null,
    method: scenario.reinvest ? `${DIVIDEND_METHOD} ${DRIP_METHOD}` : DIVIDEND_METHOD,
  })
}

/**
 * A starting yield assumption taken from the portfolio's **own** trailing income.
 *
 * This is derived from the user's data rather than invented, which is what makes it a defensible
 * default. Null when there is no income or no value to divide it by — an assumption Stockly cannot
 * ground in something real is one the user has to supply.
 */
export function impliedYield(
  trailingTwelveMonthIncome: number,
  portfolioValue: number,
): number | null {
  if (!Number.isFinite(trailingTwelveMonthIncome) || trailingTwelveMonthIncome <= 0) return null
  if (!Number.isFinite(portfolioValue) || portfolioValue <= 0) return null
  return quantize(trailingTwelveMonthIncome / portfolioValue, 1_000_000_000)
}
