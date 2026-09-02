"use client"

import { useState } from "react"
import type { Currency } from "@/domain/market"
import {
  SCENARIO_RETURNS,
  type ContributionFrequency,
  type GrowthScenario,
  type ScenarioName,
} from "@/domain/simulation"

/**
 * The growth assumptions three of the five simulators share.
 *
 * Held as strings, parsed once when a scenario is built. A controlled number input that coerces on
 * every keystroke cannot be cleared and cannot hold "0." on the way to "0.5"; keeping the text and
 * parsing at the boundary means a half-typed value is a half-typed value rather than a NaN.
 *
 * Percentages stay percentages here — the form of the number the user typed — and become decimal
 * fractions exactly once, in `toScenario`.
 */
export type ScenarioState = {
  scenario: ScenarioName
  initialValue: string
  contribution: string
  frequency: ContributionFrequency
  annualReturnPct: string
  years: string
  contributionGrowthPct: string
  /** Empty means the question was not asked; every real-value output is then null. */
  inflationPct: string
}

export function useScenarioState(initial: Partial<ScenarioState> = {}) {
  const [state, setState] = useState<ScenarioState>({
    scenario: "BASE",
    initialValue: "0",
    contribution: "10000",
    frequency: "MONTHLY",
    annualReturnPct: String(SCENARIO_RETURNS.BASE * 100),
    years: "10",
    contributionGrowthPct: "0",
    inflationPct: "",
    ...initial,
  })

  const set = <K extends keyof ScenarioState>(key: K) => (value: ScenarioState[K]) =>
    setState((previous) => ({ ...previous, [key]: value }))

  /** Choosing a named scenario fills the rate and leaves it editable. */
  const pickScenario = (scenario: ScenarioName, annualReturnPct: number) =>
    setState((previous) => ({ ...previous, scenario, annualReturnPct: String(annualReturnPct) }))

  return { state, set, setState, pickScenario }
}

/** An empty or unparseable field becomes 0 rather than NaN; the engine validates from there. */
export function num(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/** Null when the field was left blank — "not asked" is not "zero". */
export function optionalNum(value: string): number | null {
  if (value.trim() === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Turns the form's state into the engine's scenario. The one place percentages become fractions. */
export function toScenario(state: ScenarioState, currency: Currency): GrowthScenario {
  const inflationPct = optionalNum(state.inflationPct)
  return {
    initialValue: num(state.initialValue),
    contribution: num(state.contribution),
    frequency: state.frequency,
    // The application-wide convention; see domain/simulation/types.ts.
    timing: "END",
    annualReturn: num(state.annualReturnPct) / 100,
    years: num(state.years),
    contributionGrowth: num(state.contributionGrowthPct) / 100,
    inflationRate: inflationPct === null ? null : inflationPct / 100,
    currency,
  }
}

/** What a refused simulation should say, keyed by the reason the engine gave. */
export const REASON_TEXT: Record<string, string> = {
  INVALID_INITIAL_VALUE: "Enter a starting value of zero or more.",
  INVALID_CONTRIBUTION: "Enter a contribution of zero or more.",
  INVALID_RETURN: "Enter an annual return between −100% and 1000%.",
  INVALID_DURATION: "Enter a duration between 1 and 50 years.",
  INVALID_INFLATION: "Enter an inflation rate above −100%.",
  NO_FX_RATE: "No exchange rate is available for this currency.",
  INSUFFICIENT_HISTORY: "There is not enough history to base this assumption on.",
  TARGET_UNREACHABLE: "Enter a target above 0.",
}
