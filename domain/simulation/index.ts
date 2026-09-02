/**
 * The simulation engine.
 *
 * Everything here is a pure function: no database, no network, no model, no clock beyond what is
 * passed in. Given the same inputs it returns the same numbers forever, which is what makes a
 * scenario something a user can check rather than something they have to trust — and what lets the
 * whole thing run in the browser as a slider moves, with no round trip.
 *
 * **It never writes.** There is no client, no writer and no code path from here to a transaction.
 * `invariants.test.ts` proves the portfolio it was handed comes back untouched.
 *
 * Full methodology, including every formula and convention, in `docs/SIMULATION.md`.
 */
export {
  GROWTH_METHOD,
  compareReturns,
  futureValue,
  periodicRate,
  realReturn,
  realValue,
  simulateGrowth,
} from "./growth"

export {
  planGoal,
  requiredContribution,
  scenarioMatrix,
  yearsUntil,
  type GoalPlan,
  type GoalPlanInput,
  type ScenarioRow,
} from "./goal-plan"

export {
  DIVIDEND_METHOD,
  DRIP_METHOD,
  impliedYield,
  projectDividends,
  type DividendProjection,
  type DividendScenario,
  type DividendYear,
} from "./dividend-plan"

export {
  simulateWhatIf,
  uniformPriceShock,
  type PriceAdjustment,
  type QuantityAdjustment,
  type WhatIfHolding,
  type WhatIfInput,
  type WhatIfResult,
} from "./what-if"

export {
  CONTRIBUTION_FREQUENCIES,
  FREQUENCY_LABELS,
  MAX_ANNUAL_RETURN,
  MAX_YEARS,
  MIN_ANNUAL_RETURN,
  PERIODS_PER_YEAR,
  SCENARIOS,
  SCENARIO_LABELS,
  SCENARIO_RETURNS,
  failed,
  ok,
  type ContributionFrequency,
  type ContributionTiming,
  type GrowthPoint,
  type GrowthResult,
  type GrowthScenario,
  type ScenarioName,
  type Simulated,
  type SimulationError,
} from "./types"
