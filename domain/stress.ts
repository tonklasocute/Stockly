import { percentOf, quantize, sumBy } from "./money"
import { symbolKey, type Currency, type MarketId } from "./market"
import { simulateWhatIf, type PriceAdjustment, type WhatIfResult } from "./simulation/what-if"
import type { DrawdownHistory } from "./drawdown-history"
import type { Holding } from "./types"

/**
 * Stress testing.
 *
 * **There is no second calculation engine here.** Every figure below comes from `simulateWhatIf`,
 * the phase 11 what-if engine, which already restates a portfolio under given prices and rates and
 * is already covered by `domain/simulation/invariants.test.ts`. What this module adds is the part
 * that was missing:
 *
 *   - *builders* that turn "US technology −20%" into the per-instrument price adjustments the
 *     engine takes — the same shape `uniformPriceShock` has always had;
 *   - **coverage accounting**, so a scenario says which holdings it could not reach and why;
 *   - **component decomposition**, so a combined shock is traceable rather than a single number;
 *   - **recovery arithmetic**, which existed nowhere.
 *
 * Two rules hold throughout, and both are enforced by tests rather than by discipline:
 *
 * **A scenario is arithmetic on assumptions somebody chose. It is not a forecast.** The vocabulary
 * says so everywhere — `scenarioValue`, never an expected one; "required gain to return to the
 * starting value", never an expected recovery. `FORBIDDEN_STRESS_PATTERNS` is checked by a test.
 *
 * **It cannot change anything.** This module has no client, no writer, no network, no framework
 * import and no clock: `calculatedAt` is passed in, which is also what makes a run reproducible.
 */

/** Bumped when a formula changes, so a stored or exported result stays readable. */
export const STRESS_CALCULATION_VERSION = 1

export const STRESS_SCENARIO_TYPES = [
  "UNIFORM_SHOCK",
  "INSTRUMENT_SHOCK",
  "MARKET_SHOCK",
  "SECTOR_SHOCK",
  "CURRENCY_SHOCK",
  "COMBINED_SHOCK",
  "HISTORICAL_SCENARIO",
] as const
export type StressScenarioType = (typeof STRESS_SCENARIO_TYPES)[number]

/**
 * One assumption in a scenario.
 *
 * `changePct` is always a percentage move from where things stand now: −20 is a fall of a fifth.
 * A `CURRENCY` component moves the **rate at which that currency translates into the portfolio's
 * base currency** — see `CURRENCY_DIRECTION` below, because this is the one that is easy to read
 * backwards.
 */
export type ShockComponent =
  | { kind: "UNIFORM"; changePct: number }
  | { kind: "INSTRUMENT"; symbol: string; market: MarketId; changePct: number }
  | { kind: "MARKET"; market: MarketId; changePct: number }
  | { kind: "SECTOR"; sector: string; changePct: number }
  | { kind: "CURRENCY"; currency: Currency; changePct: number }

/**
 * What a currency component means, stated once so no screen has to guess.
 *
 * A positive move makes one unit of that currency worth **more** of the portfolio's base currency,
 * which raises the base-currency value of every holding denominated in it. For a baht-based
 * portfolio, "USD +10%" means the dollar buys 10% more baht, so the American holdings are worth
 * more baht — and the American holdings' own prices have not moved at all.
 *
 * Asset price and exchange rate are separate assumptions and are applied separately.
 */
export const CURRENCY_DIRECTION =
  "A positive move means one unit of that currency is worth more of the portfolio's base currency, so holdings denominated in it are worth more. It does not change any instrument's own price."

export type StressScenario = {
  name: string
  type: StressScenarioType
  components: readonly ShockComponent[]
  /** Free text shown beside the result — where a historical scenario's magnitude came from, say. */
  note?: string
}

// ---------------------------------------------------------------- coverage

/**
 * Why a holding is not carrying a scenario's shock.
 *
 * `UNAFFECTED` is deliberately **not** an exclusion: a Thai holding in a US-market shock is behaving
 * correctly, and listing it as a gap would bury the real ones. Only the two below are gaps — cases
 * where the scenario should have reached a holding and the data would not let it.
 */
export const EXCLUSION_REASONS = {
  NO_SECTOR: "No sector classification, so a sector shock cannot be applied to it.",
  NO_FX_RATE: "No exchange rate reaches the portfolio's base currency, so it is in no total.",
} as const
export type ExclusionReason = keyof typeof EXCLUSION_REASONS

export type ExcludedPosition = {
  symbol: string
  market: MarketId
  reason: ExclusionReason
}

export type StressCoverage = {
  /** Holdings in the portfolio. */
  total: number
  /** Holdings the scenario actually moved. */
  shocked: number
  /**
   * Holdings the scenario correctly left alone — out of its scope, not missing from it. A US shock
   * does not touch a Thai holding, and that is the scenario working.
   */
  unaffected: number
  /** Holdings the scenario should have reached and could not. These are the gaps. */
  excluded: ExcludedPosition[]
}

// ---------------------------------------------------------------- results

export type StressPosition = {
  symbol: string
  market: MarketId
  currency: Currency
  /** Percentage applied to this instrument's price. 0 when the scenario left it alone. */
  priceChangePct: number
  currentPrice: number
  scenarioPrice: number
  /** In the portfolio's base currency. Null when no rate reaches it — never 0. */
  currentBaseValue: number | null
  scenarioBaseValue: number | null
  impact: number | null
  /** Share of the portfolio's total impact this position accounts for. Null when either is unknown. */
  impactSharePct: number | null
}

/** One component's marginal effect, in the order the components were applied. */
export type ComponentImpact = {
  component: ShockComponent
  label: string
  /** Portfolio value before this component was added to the ones before it. */
  runningValueBefore: number
  runningValueAfter: number
  impact: number
  /** Holdings this component moved. Zero is a real answer — the scenario matched nothing. */
  positionsAffected: number
}

/**
 * What it would take to get back to where the portfolio started.
 *
 * Pure arithmetic on two numbers, and the name says exactly that. A fall of 20% needs a rise of 25%
 * because the rise is measured against the smaller base — the asymmetry people underestimate.
 */
export type RecoveryRequirement = {
  /** The fall being recovered from, as a negative percentage. */
  fromPct: number
  /** The rise required to return to the starting value. */
  requiredGainPct: number
}

export type StressResult = {
  scenario: StressScenario
  calculationVersion: number
  /** Supplied by the caller. This module has no clock, which is what keeps a run reproducible. */
  calculatedAt: string | null
  /** When the prices behind `baseValue` were read. Null when unknown — never today's date. */
  dataAsOf: string | null
  baseCurrency: Currency
  baseValue: number
  stressedValue: number
  absoluteImpact: number
  /** Null when the portfolio has no value to measure against. */
  percentageImpact: number | null
  positions: StressPosition[]
  components: ComponentImpact[]
  coverage: StressCoverage
  /** Null when nothing was lost, or when the loss is total — see `recoveryGainPct`. */
  recovery: RecoveryRequirement | null
  /** The scenario restated in sentences, for the panel that must sit beside every figure. */
  assumptions: string[]
}

// ---------------------------------------------------------------- recovery arithmetic

/**
 * The rise required to undo a fall.
 *
 *   value → value × (1 + d)   and back needs   1 / (1 + d)
 *   so the required gain is   −d / (1 + d)
 *
 * −10% needs +11.11%. −50% needs +100%. −80% needs +400%.
 *
 * Null in the two cases where the question does not apply: nothing was lost (a rise needs no
 * recovery), and everything was lost (no finite gain restores a value of zero). Both render "N/A",
 * which is the truthful answer rather than a large number that looks like an estimate.
 */
export function recoveryGainPct(changePct: number): number | null {
  if (!Number.isFinite(changePct)) return null
  if (changePct >= 0) return null
  if (changePct <= -100) return null
  const d = changePct / 100
  return quantize((-d / (1 + d)) * 100)
}

// ---------------------------------------------------------------- builders

/** Every holding's key, for the membership tests below. */
function keyOf(holding: Pick<Holding, "symbol" | "market">): string {
  return symbolKey(holding.symbol, holding.market)
}

/**
 * Which holdings one component applies to.
 *
 * A sector lookup that returns null is a *gap* and is reported as one; a holding in another market
 * is simply out of scope. Keeping those apart is the whole reason coverage is worth reporting.
 */
function matches(
  component: ShockComponent,
  holding: Holding,
  sectors: Readonly<Record<string, string | null>>,
): { applies: boolean; excluded: ExclusionReason | null } {
  switch (component.kind) {
    case "UNIFORM":
      return { applies: true, excluded: null }
    case "INSTRUMENT":
      return {
        applies: keyOf(holding) === symbolKey(component.symbol, component.market),
        excluded: null,
      }
    case "MARKET":
      return { applies: holding.market === component.market, excluded: null }
    case "SECTOR": {
      const sector = sectors[keyOf(holding)] ?? sectors[holding.symbol] ?? null
      if (sector === null) return { applies: false, excluded: "NO_SECTOR" }
      return { applies: sector.toLowerCase() === component.sector.toLowerCase(), excluded: null }
    }
    case "CURRENCY":
      // Handled through fxOverrides, never as a price move.
      return { applies: false, excluded: null }
  }
}

/**
 * Turns the price components into the adjustments the engine takes.
 *
 * Components **compound** rather than replace: a holding caught by both "US −15%" and
 * "Technology −20%" ends at 0.85 × 0.80. That is the honest reading of two simultaneous
 * assumptions, and applying only the last one would silently discard the other.
 */
export function priceAdjustmentsFor(
  holdings: readonly Holding[],
  components: readonly ShockComponent[],
  sectors: Readonly<Record<string, string | null>> = {},
): PriceAdjustment[] {
  const out: PriceAdjustment[] = []

  for (const holding of holdings) {
    let factor = 1
    let touched = false
    for (const component of components) {
      if (component.kind === "CURRENCY") continue
      if (!matches(component, holding, sectors).applies) continue
      factor *= 1 + component.changePct / 100
      touched = true
    }
    if (!touched) continue
    // Clamped at zero: a price cannot go below nothing, and the engine clamps too.
    out.push({
      symbol: holding.symbol,
      market: holding.market,
      changePct: (Math.max(0, factor) - 1) * 100,
    })
  }

  return out
}

/**
 * Scenario exchange rates from the currency components.
 *
 * The base currency is never overridden: its rate is the identity, and "shocking" it would be
 * shocking everything by the reciprocal, which is a different scenario written confusingly.
 */
export function fxOverridesFor(
  holdings: readonly Holding[],
  components: readonly ShockComponent[],
  baseCurrency: Currency,
): Partial<Record<Currency, number>> {
  const overrides: Partial<Record<Currency, number>> = {}

  for (const component of components) {
    if (component.kind !== "CURRENCY") continue
    if (component.currency === baseCurrency) continue

    // The rate a holding in that currency is actually valued at today. Without one there is
    // nothing to move, and the scenario cannot invent a rate any more than the portfolio could.
    const current = holdings.find(
      (holding) => holding.currency === component.currency && holding.fx?.rate != null,
    )?.fx?.rate
    if (current === undefined) continue

    const existing = overrides[component.currency] ?? current
    overrides[component.currency] = existing * (1 + component.changePct / 100)
  }

  return overrides
}

// ---------------------------------------------------------------- the run

export type StressInput = {
  holdings: readonly Holding[]
  baseCurrency: Currency
  /** The portfolio's cash today, in the base currency. Unmoved by a price scenario. */
  cash: number
  /**
   * Sector per `symbolKey` — and, as a fallback, per bare symbol. A holding absent from this map
   * has no sector, and a sector shock reports it as excluded rather than quietly missing it.
   */
  sectors?: Readonly<Record<string, string | null>>
  /** When the prices behind the current valuation were read. */
  dataAsOf?: string | null
  /** Passed in rather than read from a clock, so the same inputs give the same result. */
  calculatedAt?: string | null
}

function labelOf(component: ShockComponent): string {
  const move = `${component.changePct > 0 ? "+" : ""}${component.changePct}%`
  switch (component.kind) {
    case "UNIFORM":
      return `Every holding ${move}`
    case "INSTRUMENT":
      return `${symbolKey(component.symbol, component.market)} ${move}`
    case "MARKET":
      return `${component.market} holdings ${move}`
    case "SECTOR":
      return `${component.sector} ${move}`
    case "CURRENCY":
      return `${component.currency} ${move} against the base currency`
  }
}

/**
 * The one sentence every stress screen must carry, verbatim.
 *
 * A **fixed constant**, not a generated line, and deliberately kept out of `assumptionsOf` — which
 * is checked against `FORBIDDEN_STRESS_PATTERNS`. Those patterns are blunt by design (the word
 * "forecast" at all, as in `domain/insights.ts`), so a disclaimer that has to say the word cannot
 * live inside the checked text without weakening the check for every other sentence. Separating
 * them keeps the guarantee strict where prose is generated, and keeps the disclaimer exact where
 * it must not drift.
 */
export const STRESS_DISCLAIMER = "Hypothetical scenario — not a forecast."

/**
 * The assumptions that must sit beside every figure, never hidden and never collapsible.
 *
 * Generated prose, and therefore subject to `FORBIDDEN_STRESS_PATTERNS`. The disclaimer above is
 * rendered alongside these, not among them.
 */
export function assumptionsOf(scenario: StressScenario, baseCurrency: Currency): string[] {
  const lines = scenario.components.map(labelOf)
  lines.push(`Values are stated in ${baseCurrency}.`)
  lines.push("Cash is unchanged: a price scenario does not move a bank balance.")
  lines.push(
    "Quantities are unchanged. This restates what is held today at different prices; it models no buying or selling.",
  )
  if (scenario.components.some((c) => c.kind === "CURRENCY")) lines.push(CURRENCY_DIRECTION)
  if (scenario.components.filter((c) => c.kind !== "CURRENCY").length > 1) {
    lines.push(
      "Where two assumptions reach the same holding they compound, and the components below are listed in the order they were applied.",
    )
  }
  lines.push("Nothing here is a statement about what happens next.")
  return lines
}

function coverageOf(
  holdings: readonly Holding[],
  components: readonly ShockComponent[],
  sectors: Readonly<Record<string, string | null>>,
  result: WhatIfResult,
): StressCoverage {
  const excluded: ExcludedPosition[] = []
  let shocked = 0
  let unaffected = 0

  const hasSectorComponent = components.some((c) => c.kind === "SECTOR")
  // Indexed rather than searched: a `find` inside this loop is O(n²), which a thousand-holding
  // portfolio turns into a million comparisons for an answer a map gives in one.
  const byKey = new Map(result.holdings.map((h) => [keyOf(h), h] as const))

  for (const holding of holdings) {
    const scenario = byKey.get(keyOf(holding))
    const moved = scenario ? scenario.scenarioPrice !== scenario.currentPrice : false

    /*
     * A holding with no rate is excluded from every total, so a scenario cannot say anything about
     * it — reported whether or not the scenario would otherwise have reached it, because its
     * absence from the totals is the thing a reader needs to know.
     */
    if (scenario?.scenarioBaseValue === null) {
      excluded.push({ symbol: holding.symbol, market: holding.market, reason: "NO_FX_RATE" })
      continue
    }

    if (moved) {
      shocked += 1
      continue
    }

    const missingSector =
      hasSectorComponent &&
      (sectors[keyOf(holding)] ?? sectors[holding.symbol] ?? null) === null

    if (missingSector) {
      excluded.push({ symbol: holding.symbol, market: holding.market, reason: "NO_SECTOR" })
    } else {
      unaffected += 1
    }
  }

  return { total: holdings.length, shocked, unaffected, excluded }
}

/**
 * A combined scenario, broken into the marginal effect of each assumption.
 *
 * Components are applied cumulatively in the order given, and each one's impact is the change it
 * makes on top of the ones before it. **The order is therefore part of the answer** and is stated
 * in the assumptions: with compounding assumptions there is no order-free attribution, and
 * pretending otherwise would be a made-up allocation of a real number.
 *
 * The parts sum exactly to the whole by construction, because each is a difference between two
 * runs of the same engine.
 */
function decompose(input: StressInput, scenario: StressScenario, baseValue: number): ComponentImpact[] {
  const sectors = input.sectors ?? {}
  const out: ComponentImpact[] = []
  let running = baseValue

  for (let index = 0; index < scenario.components.length; index += 1) {
    const upTo = scenario.components.slice(0, index + 1)
    const component = scenario.components[index]

    const result = simulateWhatIf({
      holdings: input.holdings,
      baseCurrency: input.baseCurrency,
      cash: input.cash,
      cashDelta: 0,
      priceAdjustments: priceAdjustmentsFor(input.holdings, upTo, sectors),
      quantityAdjustments: [],
      fxOverrides: fxOverridesFor(input.holdings, upTo, input.baseCurrency),
    })

    const before = running
    running = result.scenarioTotal

    const affected =
      component.kind === "CURRENCY"
        ? input.holdings.filter((h) => h.currency === component.currency).length
        : priceAdjustmentsFor(input.holdings, [component], sectors).length

    out.push({
      component,
      label: labelOf(component),
      runningValueBefore: before,
      runningValueAfter: running,
      impact: quantize(running - before),
      positionsAffected: affected,
    })
  }

  return out
}

/**
 * Runs a scenario.
 *
 * Everything numeric comes back from `simulateWhatIf`. Nothing here recomputes a portfolio value,
 * a weight or a cost basis — which is what keeps a stress figure and the dashboard from ever
 * disagreeing about what the portfolio is worth.
 */
export function runStress(input: StressInput, scenario: StressScenario): StressResult {
  const sectors = input.sectors ?? {}

  const result = simulateWhatIf({
    holdings: input.holdings,
    baseCurrency: input.baseCurrency,
    cash: input.cash,
    cashDelta: 0,
    priceAdjustments: priceAdjustmentsFor(input.holdings, scenario.components, sectors),
    quantityAdjustments: [],
    fxOverrides: fxOverridesFor(input.holdings, scenario.components, input.baseCurrency),
  })

  const baseValue = result.currentTotal
  const stressedValue = result.scenarioTotal
  const absoluteImpact = result.difference
  const percentageImpact = result.differencePct

  const totalImpact = absoluteImpact

  const positions: StressPosition[] = result.holdings.map((holding) => ({
    symbol: holding.symbol,
    market: holding.market,
    currency: holding.currency,
    // The engine reports null only when the current price is zero; a holding the scenario did not
    // move genuinely changed by 0%, which is a measurement rather than a gap.
    priceChangePct: holding.priceChangePct ?? 0,
    currentPrice: holding.currentPrice,
    scenarioPrice: holding.scenarioPrice,
    currentBaseValue: holding.currentBaseValue,
    scenarioBaseValue: holding.scenarioBaseValue,
    impact: holding.baseValueDelta,
    impactSharePct:
      holding.baseValueDelta === null || totalImpact === 0
        ? null
        : percentOf(holding.baseValueDelta, totalImpact),
  }))

  return {
    scenario,
    calculationVersion: STRESS_CALCULATION_VERSION,
    calculatedAt: input.calculatedAt ?? null,
    dataAsOf: input.dataAsOf ?? null,
    baseCurrency: input.baseCurrency,
    baseValue,
    stressedValue,
    absoluteImpact,
    percentageImpact,
    positions,
    components: scenario.components.length > 1 ? decompose(input, scenario, baseValue) : [],
    coverage: coverageOf(input.holdings, scenario.components, sectors, result),
    recovery:
      percentageImpact === null
        ? null
        : (() => {
            const required = recoveryGainPct(percentageImpact)
            return required === null ? null : { fromPct: percentageImpact, requiredGainPct: required }
          })(),
    assumptions: assumptionsOf(scenario, input.baseCurrency),
  }
}

// ---------------------------------------------------------------- the matrix

/** The falls a matrix reports by default. Named, not scattered through a component. */
export const DEFAULT_MATRIX_SHOCKS = [-5, -10, -20, -30, -50] as const

export type MatrixRow = {
  changePct: number
  stressedValue: number
  absoluteImpact: number
  percentageImpact: number | null
  requiredGainPct: number | null
}

/**
 * The same portfolio under a series of uniform falls.
 *
 * Every row is a real run of the engine rather than the first row scaled — with untranslatable
 * holdings and a cash balance that does not move, the relationship is not proportional and
 * multiplying would quietly misstate it.
 */
export function stressMatrix(
  input: StressInput,
  shocks: readonly number[] = DEFAULT_MATRIX_SHOCKS,
): MatrixRow[] {
  return shocks.map((changePct) => {
    const result = runStress(input, {
      name: `${changePct}%`,
      type: "UNIFORM_SHOCK",
      components: [{ kind: "UNIFORM", changePct }],
    })
    return {
      changePct,
      stressedValue: result.stressedValue,
      absoluteImpact: result.absoluteImpact,
      percentageImpact: result.percentageImpact,
      requiredGainPct: result.recovery?.requiredGainPct ?? null,
    }
  })
}

// ---------------------------------------------------------------- historical

/**
 * The worst fall this portfolio has actually been through, as a scenario.
 *
 * **Nothing is invented.** The magnitude is `drawdownHistory`'s deepest observed event, measured on
 * the flow-adjusted return index so a deposit was never mistaken for a recovery. When there is not
 * enough history the answer is `null`, and the screen says why rather than showing a plausible
 * round number.
 *
 * It is a *historical* scenario and is labelled as one: that this happened once says nothing about
 * whether it happens again, and the note carries the dates so a reader can see the difference.
 */
export function historicalScenario(history: DrawdownHistory | null): StressScenario | null {
  const worst = history?.worst
  if (!worst || !Number.isFinite(worst.depthPct) || worst.depthPct <= 0) return null

  /*
   * `depthPct` is a **positive** depth — a 20% fall is 20 — and a shock component is a signed move.
   * Negating it here is the whole conversion, and getting it backwards would apply the worst fall
   * in this portfolio's history as a rally.
   */
  const changePct = quantize(-worst.depthPct)

  return {
    name: "Worst observed fall",
    type: "HISTORICAL_SCENARIO",
    components: [{ kind: "UNIFORM", changePct }],
    note:
      `The deepest fall this portfolio has been through: ${quantize(worst.depthPct)}% between ` +
      `${worst.peakDate} and ${worst.troughDate}` +
      (worst.recoveryDate ? `, recovered by ${worst.recoveryDate}.` : ", not yet recovered.") +
      " Applying it here is a historical scenario, not a statement about what happens next.",
  }
}

// ---------------------------------------------------------------- vocabulary

/**
 * Sentences a stress result may never contain.
 *
 * The same device as `FORBIDDEN_INSIGHT_PATTERNS`: a prompt is a request, a check is a guarantee.
 * A stress test is the single easiest place in this application to slip from "this is what the
 * arithmetic says" into "this is what will happen".
 */
export const FORBIDDEN_STRESS_PATTERNS: readonly RegExp[] = [
  /\bwill (?:rise|fall|drop|recover|return|reach)\b/i,
  /\bexpected (?:return|loss|recovery|value|price)\b/i,
  /\bforecast\b/i,
  /\bpredict(?:s|ed|ion)?\b/i,
  /\blikely to\b/i,
  /\bprobably\b/i,
  /\bshould (?:buy|sell|reduce|increase|hold)\b/i,
  /\b(?:buy|sell|hold) (?:this|these|now)\b/i,
  /\brecommend(?:s|ed|ation)?\b/i,
  /\btoo (?:risky|concentrated|exposed)\b/i,
  /\bguarantee[ds]?\b/i,
]

export function findForbiddenStressPattern(text: string): RegExp | null {
  return FORBIDDEN_STRESS_PATTERNS.find((pattern) => pattern.test(text)) ?? null
}

/** A one-line description of what a scenario assumes. Never a claim about what will happen. */
export function describeScenario(scenario: StressScenario): string {
  if (scenario.components.length === 0) return "No assumptions — nothing is changed."
  return scenario.components.map(labelOf).join(" · ")
}

/** Total impact across a matrix, for a summary line. Sums a single currency only. */
export function worstRow(rows: readonly MatrixRow[]): MatrixRow | null {
  if (rows.length === 0) return null
  return rows.reduce((worst, row) => (row.absoluteImpact < worst.absoluteImpact ? row : worst))
}

/** Sum of a set of position impacts, skipping the ones that could not be valued. */
export function totalPositionImpact(positions: readonly StressPosition[]): number {
  return sumBy(
    positions.filter((p) => p.impact !== null),
    (p) => p.impact ?? 0,
  )
}
