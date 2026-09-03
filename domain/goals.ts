/**
 * Portfolio goals, and the scenarios a user can model against them.
 *
 * The rule that shapes this file: **a goal type decides what "progress" means.** Dividing whatever
 * number is handy by the target would make three of the four types wrong — a dividend-income goal
 * measured against portfolio value is not slightly off, it is a different question — so each type
 * names the figure it reads and where that figure comes from.
 *
 * None of these figures is stored. Every one is read from the existing calculation engine, so a
 * goal can never disagree with the dashboard, and creating or deleting a goal cannot move a single
 * number in the portfolio.
 *
 * Pure: no clock beyond what is passed in, no database, no framework.
 */
import { isCapitalFlow, signedAmount, type DomainCashTransaction } from "./cash"
import { percentOf, quantize, roundTo } from "./money"
import type { Currency } from "./market"

export const GOAL_TYPES = [
  "PORTFOLIO_VALUE",
  "INVESTED_CAPITAL",
  "DIVIDEND_INCOME",
  "TOTAL_RETURN",
] as const

export type GoalType = (typeof GOAL_TYPES)[number]

/**
 * What each type measures, in one line each — the same text the UI shows, so the definition a user
 * reads is the definition the code uses.
 */
export const GOAL_DEFINITIONS: Record<GoalType, { label: string; measures: string; unit: "money" | "percent" }> = {
  PORTFOLIO_VALUE: {
    label: "Portfolio value",
    measures: "Holdings at market value plus cash. The number on the dashboard.",
    unit: "money",
  },
  INVESTED_CAPITAL: {
    label: "Invested capital",
    measures:
      "Cost basis of the positions currently held, fees included — the same figure the dashboard " +
      "labels 'Invested capital'. Not the same as money deposited: a sold position releases its cost.",
    unit: "money",
  },
  DIVIDEND_INCOME: {
    label: "Dividend income",
    measures:
      "Net dividends received in the last twelve months, after tax and fees. A rate of income, " +
      "not a lifetime total, so the target is an annual figure.",
    unit: "money",
  },
  TOTAL_RETURN: {
    label: "Total return",
    measures:
      "Unrealised return on the invested value of open positions, as a percentage — the same " +
      "definition portfolio return alerts use. Realised gains and dividends are reported separately.",
    unit: "percent",
  },
}

export type DomainGoal = {
  type: GoalType
  targetValue: number
  /** The currency `targetValue` is in. Null for TOTAL_RETURN, which is a percentage. */
  currency: Currency | null
  /** ISO date. Null for a goal with no deadline. */
  targetDate: string | null
}

/**
 * The figures a goal is measured against, all supplied by the caller from `loadAnalytics` — this
 * module never fetches anything and never recomputes a financial number.
 */
export type GoalFacts = {
  /** The portfolio's base currency; every money figure below is in it. */
  baseCurrency: Currency
  totalValue: number
  investedValue: number
  trailingTwelveMonthDividends: number
  returnPct: number
}

export type GoalProgress = {
  type: GoalType
  /** Where the portfolio stands today, in the goal's own unit. */
  current: number
  target: number
  /** 0–100+, uncapped: passing a goal is worth seeing. Null when it cannot be computed honestly. */
  progressPct: number | null
  /** Target minus current, floored at 0. Null when progress is null. */
  remaining: number | null
  achieved: boolean
  unit: "money" | "percent"
  currency: Currency | null
  targetDate: string | null
  /** Whole days until the target date. Negative once it has passed. Null when there is no date. */
  daysRemaining: number | null
  /** Set when progress could not be computed, so the UI can explain rather than show a blank. */
  unavailableReason: string | null
}

/**
 * Progress on one goal.
 *
 * `convert` translates a money target into the portfolio's base currency; it is the same converter
 * the holdings engine uses, so a THB goal on a USD portfolio is measured at the same rate every
 * other figure on the page was. When there is no rate the answer is `null` and a reason — never a
 * comparison of two different currencies' numbers, which would be arithmetic on nothing.
 */
export function goalProgress(
  goal: DomainGoal,
  facts: GoalFacts,
  {
    now = new Date(),
    convert,
  }: { now?: Date; convert?: (amount: number, from: Currency) => { value: number } | null } = {},
): GoalProgress {
  const definition = GOAL_DEFINITIONS[goal.type]
  const daysRemaining = goal.targetDate
    ? Math.round(
        (Date.parse(`${goal.targetDate}T00:00:00Z`) -
          Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) /
          86_400_000,
      )
    : null

  const base = {
    type: goal.type,
    target: goal.targetValue,
    unit: definition.unit,
    currency: goal.currency,
    targetDate: goal.targetDate,
    daysRemaining,
  }

  // A percentage goal needs no conversion: a return of 8% is 8% in every currency.
  if (definition.unit === "percent") {
    const current = facts.returnPct
    return {
      ...base,
      current,
      progressPct: progressOf(current, goal.targetValue),
      remaining: goal.targetValue > current ? quantize(goal.targetValue - current) : 0,
      achieved: current >= goal.targetValue,
      unavailableReason: null,
    }
  }

  // A money goal has to be stated in the currency the portfolio is measured in.
  let target = goal.targetValue
  if (goal.currency && goal.currency !== facts.baseCurrency) {
    const converted = convert?.(goal.targetValue, goal.currency)
    if (!converted) {
      return {
        ...base,
        current: currentFor(goal.type, facts),
        progressPct: null,
        remaining: null,
        achieved: false,
        unavailableReason: `No exchange rate from ${goal.currency} to ${facts.baseCurrency}.`,
      }
    }
    target = converted.value
  }

  const current = currentFor(goal.type, facts)
  return {
    ...base,
    current,
    target: quantize(target),
    progressPct: progressOf(current, target),
    remaining: target > current ? quantize(target - current) : 0,
    achieved: current >= target,
    unavailableReason: null,
  }
}

function currentFor(type: GoalType, facts: GoalFacts): number {
  switch (type) {
    case "PORTFOLIO_VALUE":
      return facts.totalValue
    case "INVESTED_CAPITAL":
      return facts.investedValue
    case "DIVIDEND_INCOME":
      return facts.trailingTwelveMonthDividends
    case "TOTAL_RETURN":
      return facts.returnPct
  }
}

/**
 * Progress as a percentage of the target.
 *
 * Null for a non-positive target — a goal of zero is not a goal already met, it is a goal that was
 * never expressible. Negative progress (a portfolio down while chasing a positive return target) is
 * reported as-is rather than clamped: hiding it would be flattering, not informative.
 */
function progressOf(current: number, target: number): number | null {
  if (!(target > 0) || !Number.isFinite(current)) return null
  return percentOf(current, target)
}

// ---------------------------------------------------------------- projections
//
// Scenario modelling moved to `domain/simulation` in phase 11 — one compounding engine, with the
// contribution timing, frequency, escalation, inflation and closed-form solver a goal plan needs.
// What lived here was a subset of it, and keeping both would have been two places for the same
// formula to be wrong differently. `features/simulations` is what a goal page links to now.

/**
 * The average net monthly contribution over a window, from the user's **own** deposits and
 * withdrawals — a defensible default for a projection, unlike an invented savings rate.
 *
 * Null when the window contains no capital movement at all: "you have contributed nothing" and "we
 * do not know what you contribute" are different statements, and only the second should prefill a
 * form with a blank.
 */
export function averageMonthlyContribution(
  flows: readonly Pick<DomainCashTransaction, "occurredOn" | "kind" | "amount">[],
  { months = 12, now = new Date() }: { months?: number; now?: Date } = {},
): number | null {
  const cutoff = new Date(now)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months)
  const since = cutoff.toISOString().slice(0, 10)

  /*
   * Only capital flows. A contribution is money the user put in; a custody fee left the account
   * without being a withdrawal, and counting it as one would understate what they actually
   * contribute every month — and then feed that understatement into a goal projection.
   */
  const inWindow = flows.filter((f) => f.occurredOn >= since && isCapitalFlow(f.kind))
  if (inWindow.length === 0) return null

  const net = inWindow.reduce((total, f) => total + signedAmount(f), 0)
  return roundTo(net / months, 2)
}
