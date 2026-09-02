/**
 * The scenario model every simulation shares.
 *
 * One sentence governs this whole folder: **a simulation is arithmetic on assumptions the user
 * chose, and it is never a prediction.** Nothing here reads a database, calls a network, consults a
 * model or writes to a portfolio. Given the same inputs it returns the same numbers forever, which
 * is what makes a result something a user can check rather than something they have to trust.
 *
 * The vocabulary is part of the contract. A field is called `annualReturn`, not `expectedReturn`;
 * an output is a `scenario` value, not a forecast; and `docs/SIMULATION.md` records why.
 */
import type { Currency } from "../market"

/**
 * When a contribution lands inside its period.
 *
 * **Stockly uses `END` everywhere**, and the assumptions panel says so. `BEGIN` exists because the
 * distinction is real — an annuity-due earns one extra period of return on every payment, which
 * compounds into a visible difference over ten years — and a convention that cannot be named is a
 * convention nobody can check. It is not exposed as an input; there is no reason to make a user
 * choose, and a silent switch between the two would make two runs of the same scenario disagree.
 */
export type ContributionTiming = "END" | "BEGIN"

export type ContributionFrequency = "MONTHLY" | "QUARTERLY" | "YEARLY"

export const CONTRIBUTION_FREQUENCIES = ["MONTHLY", "QUARTERLY", "YEARLY"] as const

export const PERIODS_PER_YEAR: Record<ContributionFrequency, number> = {
  MONTHLY: 12,
  QUARTERLY: 4,
  YEARLY: 1,
}

export const FREQUENCY_LABELS: Record<ContributionFrequency, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  YEARLY: "Yearly",
}

/** The three named starting points. Every rate remains editable — see `SCENARIO_RETURNS`. */
export const SCENARIOS = ["CONSERVATIVE", "BASE", "OPTIMISTIC"] as const
export type ScenarioName = (typeof SCENARIOS)[number]

export const SCENARIO_LABELS: Record<ScenarioName, string> = {
  CONSERVATIVE: "Conservative",
  BASE: "Base",
  OPTIMISTIC: "Optimistic",
}

/**
 * Example annual return assumptions, as decimal fractions.
 *
 * **Placeholders, not forecasts, and not derived from anything.** They are not a house view, and
 * they are deliberately not the user's own historical return — extrapolating somebody's past into
 * their future is the thing this codebase refuses to do implicitly. A user who *wants* their own
 * history as an assumption asks for it explicitly, and gets `null` when there is not enough of it.
 *
 * Every one is editable, and the figure actually used is shown beside the result.
 */
export const SCENARIO_RETURNS: Record<ScenarioName, number> = {
  CONSERVATIVE: 0.05,
  BASE: 0.08,
  OPTIMISTIC: 0.1,
}

/**
 * A growth scenario: what is there now, what gets added, at what assumed rate, for how long.
 *
 * Rates are decimal fractions — 0.08 is 8% — because a percentage that is sometimes 8 and sometimes
 * 0.08 is the arithmetic bug that survives every code review.
 */
export type GrowthScenario = {
  /** Money already invested at the start. May be 0. */
  initialValue: number
  /** Paid in every period. May be 0. */
  contribution: number
  frequency: ContributionFrequency
  timing: ContributionTiming
  /** Assumed annual return, as a decimal fraction. May be negative. */
  annualReturn: number
  years: number
  /** Annual increase applied to the contribution itself. 0 keeps it flat. */
  contributionGrowth: number
  /**
   * Assumed annual inflation, for restating the result in today's money.
   *
   * **Null means the question was not asked**, and every real-value output is then null too — not
   * zero inflation, which is itself an assumption and a wrong one.
   */
  inflationRate: number | null
  currency: Currency
}

export type GrowthPoint = {
  /** ISO date of the end of this period. */
  date: string
  periodIndex: number
  /** Cumulative money put in, initial value included. The part that was never a return. */
  contributed: number
  /** `value − contributed`. Negative when the scenario return is negative. */
  growth: number
  value: number
  /**
   * `value` restated in today's money. Null when no inflation assumption was given — see
   * `inflationRate`.
   */
  realValue: number | null
}

export type GrowthResult = {
  scenario: GrowthScenario
  points: GrowthPoint[]
  finalValue: number
  /** Contributions only. The initial value is not a contribution; it was already there. */
  totalContributions: number
  /** Initial value plus contributions: everything that was paid in rather than earned. */
  totalInvested: number
  /** `finalValue − totalInvested`. The part that came from the assumed return. */
  totalGrowth: number
  /** Growth as a percentage of what was put in. Null when nothing was put in. */
  growthPct: number | null
  /** The final value in today's money. Null without an inflation assumption. */
  finalRealValue: number | null
  /** Prose a UI prints verbatim, so the method is never paraphrased into something else. */
  method: string
}

/**
 * Why a simulation could not be run.
 *
 * A code rather than a sentence, so the UI decides the wording and a test can assert the reason
 * without matching on prose. Every simulation returns a result or one of these — never `NaN`,
 * never `Infinity`, never a plausible-looking number derived from an impossible input.
 */
export type SimulationError =
  | "INVALID_INITIAL_VALUE"
  | "INVALID_CONTRIBUTION"
  | "INVALID_RETURN"
  | "INVALID_DURATION"
  | "INVALID_INFLATION"
  | "NO_FX_RATE"
  | "INSUFFICIENT_HISTORY"
  | "TARGET_UNREACHABLE"

export type Simulated<T> = { ok: true; value: T } | { ok: false; reason: SimulationError }

export function ok<T>(value: T): Simulated<T> {
  return { ok: true, value }
}

export function failed<T>(reason: SimulationError): Simulated<T> {
  return { ok: false, reason }
}

/** The longest horizon worth modelling. Past it, compounding an assumed rate says nothing at all. */
export const MAX_YEARS = 50

/** Guards against a rate that cannot be compounded: below −100% a fractional power is not real. */
export const MIN_ANNUAL_RETURN = -1
export const MAX_ANNUAL_RETURN = 10

export type { Currency }
