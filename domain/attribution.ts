import { add, sumBy } from "./money"
import type { Currency } from "./market"

/**
 * Performance attribution: what a portfolio's return was *made of*.
 *
 * The methodology, stated before the code because attribution is where a plausible-looking wrong
 * number is easiest to produce. Full derivation in `docs/performance-attribution.md`.
 *
 * ## The problem with the obvious formula
 *
 * The textbook single-period contribution is `weight × return`, and it is wrong here. It assumes a
 * position's weight is constant across the period, which stops being true the moment somebody buys
 * or sells — and a portfolio tracker's whole purpose is recording that somebody did. Applied to a
 * position bought halfway through a period, `weight × return` credits it with a return it was not
 * held for.
 *
 * ## What is used instead
 *
 * Contribution is computed from **money**, not from weights:
 *
 * ```
 * contribution_i (in %) = gain_i / beginningValue × 100
 *
 * where gain_i = (endValue_i − beginValue_i) − netInvested_i + dividends_i
 * ```
 *
 * `netInvested_i` is what was paid into that position during the period (buys, fees included) less
 * what was taken out of it (sale proceeds). Subtracting it is what stops a purchase from looking
 * like a gain — the money did not appear, it moved — and it is the same principle the portfolio's
 * own return uses when it removes deposits.
 *
 * This makes the components **additive against the portfolio's own money-terms gain**, which is
 * the property that lets a waterfall chart be honest: the parts sum to the whole because both are
 * measured in the same currency over the same period, rather than because a weighting scheme was
 * chosen to make them.
 *
 * ## What it is not
 *
 * It is **not** a time-weighted attribution. TWR removes the timing of external flows; this
 * measures what each holding did to the money that was actually in the portfolio. They answer
 * different questions and `docs/performance-attribution.md` says which to use when. The engine
 * reports its own basis (`ATTRIBUTION_BASIS`) so a screen can never imply the other one.
 *
 * Pure: no client, no network, no framework import.
 */

/** Named so a UI can state the basis rather than leaving a reader to assume TWR. */
export const ATTRIBUTION_BASIS = "MONEY_WEIGHTED" as const

/**
 * Why an attribution could not be produced.
 *
 * A reason code rather than a zero: "we cannot compute this" and "this contributed nothing" are
 * different facts, and a waterfall that renders the first as the second is a chart that lies.
 */
export const ATTRIBUTION_UNAVAILABLE = [
  "NO_BEGINNING_VALUE",
  "NO_ENDING_VALUE",
  "EMPTY_PERIOD",
  "NO_HISTORICAL_FX",
] as const
export type AttributionUnavailable = (typeof ATTRIBUTION_UNAVAILABLE)[number]

export const UNAVAILABLE_REASONS: Record<AttributionUnavailable, string> = {
  NO_BEGINNING_VALUE:
    "No valuation was recorded at the start of this period, so there is nothing to measure the change against.",
  NO_ENDING_VALUE: "No valuation was recorded at the end of this period.",
  EMPTY_PERIOD: "The portfolio held nothing during this period.",
  NO_HISTORICAL_FX:
    "Separating currency movement from asset performance needs an exchange rate for every day of the period, and Stockly does not store one for all of them.",
}

/** What the engine is given for one holding, over one period. */
export type HoldingPeriod = {
  symbol: string
  market: string
  currency: Currency
  /** Base-currency value at the start. Null when the position did not exist or was not valued. */
  beginValue: number | null
  /** Base-currency value at the end. Null when it could not be valued. */
  endValue: number | null
  /** Money paid into this position during the period, buy fees included. */
  invested: number
  /** Money taken out — sale proceeds, sell fees already deducted. */
  divested: number
  /** Dividends received from it during the period, in the base currency. */
  dividends: number
}

export type Contribution = {
  symbol: string
  market: string
  /** The money this holding added to the portfolio over the period. */
  gain: number
  /** That gain as a percentage of the portfolio's beginning value — percentage points of return. */
  contributionPct: number
  /**
   * What the holding itself returned, as a percentage of the money in it.
   *
   * **Not the same number as the contribution**, and the difference is the whole reason both are
   * shown: a position up 40% that was 2% of the portfolio contributed under a point. Null when the
   * position had no money in it to return anything on.
   */
  holdingReturnPct: number | null
  dividends: number
  /** True when a missing valuation meant this holding could not be measured at all. */
  incomplete: boolean
}

export type AttributionResult =
  | { ok: false; reason: AttributionUnavailable }
  | {
      ok: true
      basis: typeof ATTRIBUTION_BASIS
      beginningValue: number
      endingValue: number
      /** External money added during the period. Removed from the gain, never counted as one. */
      netFlow: number
      /** Total money gained: ending − beginning − flows. What the components sum to. */
      totalGain: number
      /** That gain as a percentage of the beginning value. */
      totalReturnPct: number
      contributions: Contribution[]
      /**
       * Dividends, reported separately as well as inside each holding's gain.
       *
       * Not a *third* component to be added on top — that would double-count. It is the part of the
       * total gain attributable to income rather than price, which is a different slice of the same
       * number. `docs/performance-attribution.md` §4 has the arithmetic.
       */
      dividendGain: number
      dividendPct: number
      /** Gain from price movement alone: total minus income. */
      priceGain: number
      pricePct: number
      /**
       * Currency movement's share, and why it is not here.
       *
       * **Always null.** Separating it needs the exchange rate on every day of the period, and
       * Stockly stores none — `domain/fx.ts` fetches today's rate and caches it for ten minutes.
       * A number here would be a guess wearing an analytic's clothes. See `docs/fx-attribution.md`
       * for exactly what would have to exist first.
       */
      fxGain: null
      fxUnavailableReason: string
      /** Holdings that could not be measured, named so the total can say what it is missing. */
      incompleteSymbols: string[]
    }

/**
 * Attribution for one period.
 *
 * Every branch that cannot answer returns a reason rather than a zero.
 */
export function attribute(input: {
  beginningValue: number | null
  endingValue: number | null
  netFlow: number
  holdings: readonly HoldingPeriod[]
}): AttributionResult {
  if (input.beginningValue === null) return { ok: false, reason: "NO_BEGINNING_VALUE" }
  if (input.endingValue === null) return { ok: false, reason: "NO_ENDING_VALUE" }
  // A beginning value of zero cannot be a denominator. A portfolio that started empty has a return
  // that is undefined rather than infinite, whatever it grew to.
  if (input.beginningValue <= 0) return { ok: false, reason: "EMPTY_PERIOD" }

  const beginningValue = input.beginningValue
  const totalGain = add(add(input.endingValue, -beginningValue), -input.netFlow)

  const contributions: Contribution[] = []
  const incompleteSymbols: string[] = []

  for (const holding of input.holdings) {
    // A holding that cannot be valued at either end is reported as incomplete rather than as a
    // contribution of zero, and its symbol is named so the total can admit what it excludes.
    const incomplete = holding.beginValue === null && holding.endValue === null
    if (incomplete) {
      incompleteSymbols.push(holding.symbol)
      contributions.push({
        symbol: holding.symbol,
        market: holding.market,
        gain: 0,
        contributionPct: 0,
        holdingReturnPct: null,
        dividends: holding.dividends,
        incomplete: true,
      })
      continue
    }

    // A position opened during the period begins at nothing; one closed during it ends at nothing.
    // Both are ordinary, and both are different from "could not be valued".
    const begin = holding.beginValue ?? 0
    const end = holding.endValue ?? 0

    /*
     * The money this holding produced.
     *
     * `end − begin` is how much its value moved; subtracting what was put in and adding back what
     * was taken out leaves only what the holding itself did. A share bought mid-period contributes
     * the movement since it was bought and not a penny of the purchase price.
     */
    const gain = add(add(add(end, -begin), -holding.invested), add(holding.divested, holding.dividends))

    // The denominator is the money actually exposed: what was there at the start plus what was
    // added. Null when neither, because a position with no money in it returned no percentage.
    const exposure = add(begin, holding.invested)

    contributions.push({
      symbol: holding.symbol,
      market: holding.market,
      gain,
      contributionPct: (gain / beginningValue) * 100,
      holdingReturnPct: exposure > 0 ? (gain / exposure) * 100 : null,
      dividends: holding.dividends,
      incomplete: false,
    })
  }

  const dividendGain = sumBy(input.holdings, (h) => h.dividends)
  const priceGain = add(totalGain, -dividendGain)

  return {
    ok: true,
    basis: ATTRIBUTION_BASIS,
    beginningValue,
    endingValue: input.endingValue,
    netFlow: input.netFlow,
    totalGain,
    totalReturnPct: (totalGain / beginningValue) * 100,
    contributions: contributions.sort((a, b) => b.gain - a.gain),
    dividendGain,
    dividendPct: (dividendGain / beginningValue) * 100,
    priceGain,
    pricePct: (priceGain / beginningValue) * 100,
    fxGain: null,
    fxUnavailableReason: UNAVAILABLE_REASONS.NO_HISTORICAL_FX,
    incompleteSymbols,
  }
}

/**
 * How far the parts miss the whole.
 *
 * Attribution's one checkable property: the contributions should sum to the portfolio's gain. They
 * will not always, and the honest thing is to measure the gap rather than to scale the parts until
 * it disappears — a residual is evidence that something (usually a holding with no valuation) was
 * not captured, and hiding it would hide the evidence.
 */
export function residual(result: Extract<AttributionResult, { ok: true }>): number {
  return add(result.totalGain, -sumBy(result.contributions, (c) => c.gain))
}

/** The best and worst, for the two lists a user actually reads. */
export function rankContributors(
  contributions: readonly Contribution[],
  limit = 5,
): { contributors: Contribution[]; detractors: Contribution[] } {
  const measured = contributions.filter((c) => !c.incomplete)
  return {
    contributors: measured.filter((c) => c.gain > 0).slice(0, limit),
    detractors: measured
      .filter((c) => c.gain < 0)
      .sort((a, b) => a.gain - b.gain)
      .slice(0, limit),
  }
}

/**
 * A sentence describing one contribution.
 *
 * Descriptive, always. "TSLA contributed −1.4 percentage points" is a fact about a period that has
 * happened; "TSLA is dragging the portfolio down and should be reviewed" is advice, and Stockly
 * does not give advice. `attribution.test.ts` checks these sentences against the same forbidden
 * vocabulary the insights engine uses.
 */
export function describeContribution(contribution: Contribution, currency: string): string {
  if (contribution.incomplete) {
    return `${contribution.symbol} could not be measured for this period.`
  }
  const direction = contribution.gain >= 0 ? "added" : "removed"
  const points = Math.abs(contribution.contributionPct).toFixed(2)
  const amount = Math.abs(contribution.gain).toFixed(2)
  return `${contribution.symbol} ${direction} ${points} percentage points (${amount} ${currency}) of the portfolio's return.`
}

// ---------------------------------------------------------------- benchmark

export type ActiveReturn = {
  portfolioReturnPct: number | null
  benchmarkReturnPct: number | null
  /** Portfolio minus benchmark, in percentage points. Null when the two are not comparable. */
  activeReturnPct: number | null
  reason: string | null
}

/**
 * Active return: how the portfolio did against its benchmark.
 *
 * Null whenever the two are not comparable, and a currency mismatch is exactly that. Subtracting a
 * baht-denominated return from a dollar-denominated one produces a number that is not a difference
 * in anything — the same rule phase 10 applied, restated here so an attribution screen cannot
 * quietly break it.
 *
 * **Brinson-style allocation and selection effects are deliberately not computed.** They require
 * the benchmark's own weights and constituent returns, which Stockly does not have: a benchmark
 * here is a single price series. Producing an "allocation effect" from a series alone would be an
 * invented number in a shape that looks authoritative, which is the worst combination available.
 */
export function activeReturn(input: {
  portfolioReturnPct: number | null
  benchmarkReturnPct: number | null
  portfolioCurrency: Currency
  benchmarkCurrency: Currency
}): ActiveReturn {
  const { portfolioReturnPct, benchmarkReturnPct } = input

  if (portfolioReturnPct === null || benchmarkReturnPct === null) {
    return {
      portfolioReturnPct,
      benchmarkReturnPct,
      activeReturnPct: null,
      reason: "One of the two returns could not be computed for this period.",
    }
  }

  if (input.portfolioCurrency !== input.benchmarkCurrency) {
    return {
      portfolioReturnPct,
      benchmarkReturnPct,
      activeReturnPct: null,
      reason: `The portfolio is measured in ${input.portfolioCurrency} and the benchmark in ${input.benchmarkCurrency}. Comparing them needs a historical exchange rate for every observation, which Stockly does not store.`,
    }
  }

  return {
    portfolioReturnPct,
    benchmarkReturnPct,
    activeReturnPct: portfolioReturnPct - benchmarkReturnPct,
    reason: null,
  }
}
