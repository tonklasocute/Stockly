/**
 * Portfolio what-if.
 *
 * A mathematical restatement of a portfolio under prices, quantities and exchange rates the user
 * typed in. **It is not a prediction**, and the vocabulary keeps saying so: a field is a
 * `scenarioPrice`, never an expected or target price.
 *
 * The safety property is structural rather than a rule anyone has to remember: this module takes
 * `readonly Holding[]` and returns new objects. It has no client, no writer and no way to reach a
 * transaction — nothing it produces can be stored, because nothing it produces is a `Transaction`.
 * `domain/simulation/invariants.test.ts` asserts the inputs come back untouched.
 */
import { percentOf, quantize, sumBy } from "../money"
import type { Currency, MarketId } from "../market"
import { symbolKey } from "../market"
import type { Holding } from "../types"

/** How a scenario changes one instrument's price. Exactly one of the two fields applies. */
export type PriceAdjustment = {
  symbol: string
  market: MarketId
  /** Percentage move from the current price, e.g. −5 for a 5% fall. */
  changePct?: number
  /** An absolute price, in the instrument's own currency. Takes precedence over `changePct`. */
  scenarioPrice?: number
}

/**
 * How a scenario changes one instrument's size.
 *
 * `amountDelta` answers "what if I put ฿100,000 into this" — converted to shares at the scenario
 * price, which is the price the rest of the scenario is using. `reducePct` answers "what if I sold
 * a quarter of it". Applied in that order: delta first, then the reduction, so "add 100,000 and
 * trim 25%" means what it reads like.
 */
export type QuantityAdjustment = {
  symbol: string
  market: MarketId
  /** Shares added. Negative removes them. */
  quantityDelta?: number
  /** Money put in, in the instrument's currency. Converted at the scenario price. */
  amountDelta?: number
  /** Percentage of the position removed, 0–100. */
  reducePct?: number
}

export type WhatIfInput = {
  holdings: readonly Holding[]
  baseCurrency: Currency
  /** The portfolio's cash today, in the base currency. */
  cash: number
  /** Cash added or removed in the scenario, in the base currency. */
  cashDelta: number
  priceAdjustments: readonly PriceAdjustment[]
  quantityAdjustments: readonly QuantityAdjustment[]
  /**
   * Scenario exchange rates, keyed by the holding's currency: units of the base currency per one
   * unit of it. Overrides the rate the holding was actually valued at.
   *
   * A currency with no override and no real rate stays untranslatable — the scenario cannot invent
   * a rate any more than the portfolio could.
   */
  fxOverrides?: Partial<Record<Currency, number>>
}

export type WhatIfHolding = {
  symbol: string
  market: MarketId
  currency: Currency
  currentQuantity: number
  scenarioQuantity: number
  currentPrice: number
  scenarioPrice: number
  /** Percentage move applied to the price. */
  priceChangePct: number | null
  /** Value in the instrument's own currency. */
  currentValue: number
  scenarioValue: number
  /** In the base currency. Null when no rate reaches it — the same rule the real portfolio follows. */
  currentBaseValue: number | null
  scenarioBaseValue: number | null
  /** Scenario base value minus current. Null when either side is unknown. */
  baseValueDelta: number | null
  /** Share of the scenario portfolio. Null when this holding could not be translated. */
  scenarioWeightPct: number | null
  currentWeightPct: number | null
  /** Cost basis in the instrument's currency, scaled with the quantity. */
  scenarioInvested: number
  scenarioUnrealizedPnl: number
  /** The rate used, and whether the user supplied it. */
  fxRate: number | null
  fxOverridden: boolean
}

export type WhatIfResult = {
  holdings: WhatIfHolding[]
  baseCurrency: Currency
  currentCash: number
  scenarioCash: number
  /** Holdings plus cash, in the base currency, over the holdings that could be translated. */
  currentTotal: number
  scenarioTotal: number
  difference: number
  differencePct: number | null
  /** Holdings excluded from both totals for want of a rate. Reported, never silently dropped. */
  untranslatedCount: number
}

/** The rate to translate one currency into the base: the user's override, else the real one. */
function rateFor(
  holding: Holding,
  baseCurrency: Currency,
  overrides: Partial<Record<Currency, number>>,
): { rate: number | null; overridden: boolean } {
  if (holding.currency === baseCurrency) return { rate: 1, overridden: false }

  const override = overrides[holding.currency]
  if (override !== undefined && Number.isFinite(override) && override > 0) {
    return { rate: override, overridden: true }
  }
  return { rate: holding.fx?.rate ?? null, overridden: false }
}

/**
 * Restates a portfolio under the given assumptions.
 *
 * Every holding is returned, including ones nothing was changed about, so the scenario table is a
 * complete portfolio rather than a diff — and so a weight, which is a share of the whole, is
 * computed against the whole.
 */
export function simulateWhatIf(input: WhatIfInput): WhatIfResult {
  const overrides = input.fxOverrides ?? {}
  const priceBy = new Map(
    input.priceAdjustments.map((a) => [symbolKey(a.symbol, a.market), a] as const),
  )
  const quantityBy = new Map(
    input.quantityAdjustments.map((a) => [symbolKey(a.symbol, a.market), a] as const),
  )

  const holdings: WhatIfHolding[] = input.holdings.map((holding) => {
    const key = symbolKey(holding.symbol, holding.market)
    const priceAdjustment = priceBy.get(key)
    const quantityAdjustment = quantityBy.get(key)

    // An absolute price wins over a percentage: it is the more specific instruction.
    const scenarioPrice =
      priceAdjustment?.scenarioPrice !== undefined && priceAdjustment.scenarioPrice >= 0
        ? priceAdjustment.scenarioPrice
        : priceAdjustment?.changePct !== undefined && Number.isFinite(priceAdjustment.changePct)
          ? Math.max(0, holding.currentPrice * (1 + priceAdjustment.changePct / 100))
          : holding.currentPrice

    // Money in becomes shares at the scenario price — the price the rest of this scenario uses.
    const fromAmount =
      quantityAdjustment?.amountDelta !== undefined && scenarioPrice > 0
        ? quantityAdjustment.amountDelta / scenarioPrice
        : 0
    const added = (quantityAdjustment?.quantityDelta ?? 0) + fromAmount
    const afterAdd = Math.max(0, holding.quantity + added)
    const reduction = quantityAdjustment?.reducePct
      ? afterAdd * (Math.min(100, Math.max(0, quantityAdjustment.reducePct)) / 100)
      : 0
    // Clamped at zero: a scenario can close a position but cannot short one, which would be a
    // different instrument with a different cost basis and no meaning here.
    const scenarioQuantity = Math.max(0, afterAdd - reduction)

    const scenarioValue = scenarioQuantity * scenarioPrice
    const { rate, overridden } = rateFor(holding, input.baseCurrency, overrides)

    // Cost basis scales with the position: selling a quarter releases a quarter of it, and adding
    // shares at the scenario price adds that price as their cost.
    const averageCost = holding.quantity > 0 ? holding.investedValue / holding.quantity : scenarioPrice
    const keptQuantity = Math.min(holding.quantity, scenarioQuantity)
    const scenarioInvested =
      keptQuantity * averageCost + Math.max(0, scenarioQuantity - holding.quantity) * scenarioPrice

    return {
      symbol: holding.symbol,
      market: holding.market,
      currency: holding.currency,
      currentQuantity: holding.quantity,
      scenarioQuantity: quantize(scenarioQuantity, 100_000_000),
      currentPrice: holding.currentPrice,
      scenarioPrice: quantize(scenarioPrice),
      priceChangePct:
        holding.currentPrice > 0
          ? percentOf(scenarioPrice - holding.currentPrice, holding.currentPrice)
          : null,
      currentValue: holding.marketValue,
      scenarioValue: quantize(scenarioValue),
      currentBaseValue: holding.baseMarketValue,
      scenarioBaseValue: rate === null ? null : quantize(scenarioValue * rate),
      baseValueDelta:
        rate === null || holding.baseMarketValue === null
          ? null
          : quantize(scenarioValue * rate - holding.baseMarketValue),
      scenarioWeightPct: null, // filled once the scenario total is known
      currentWeightPct: holding.weight,
      scenarioInvested: quantize(scenarioInvested),
      scenarioUnrealizedPnl: quantize(scenarioValue - scenarioInvested),
      fxRate: rate,
      fxOverridden: overridden,
    }
  })

  const translated = holdings.filter((h) => h.scenarioBaseValue !== null)
  const scenarioCash = quantize(input.cash + input.cashDelta)
  const scenarioHoldingsValue = sumBy(translated, (h) => h.scenarioBaseValue ?? 0)
  const currentHoldingsValue = sumBy(
    holdings.filter((h) => h.currentBaseValue !== null),
    (h) => h.currentBaseValue ?? 0,
  )

  // Cash counts in both totals, and only the positive part — a negative recorded balance is an
  // incomplete history rather than an asset, exactly as the real portfolio treats it.
  const currentTotal = quantize(currentHoldingsValue + Math.max(input.cash, 0))
  const scenarioTotal = quantize(scenarioHoldingsValue + Math.max(scenarioCash, 0))

  const withWeights = holdings.map((holding) => ({
    ...holding,
    scenarioWeightPct:
      holding.scenarioBaseValue === null || scenarioTotal <= 0
        ? null
        : percentOf(holding.scenarioBaseValue, scenarioTotal),
  }))

  return {
    holdings: withWeights,
    baseCurrency: input.baseCurrency,
    currentCash: quantize(input.cash),
    scenarioCash,
    currentTotal,
    scenarioTotal,
    difference: quantize(scenarioTotal - currentTotal),
    differencePct: percentOf(scenarioTotal - currentTotal, currentTotal),
    untranslatedCount: holdings.length - translated.length,
  }
}

/**
 * A uniform move applied to every holding — "what if the whole book fell 10%".
 *
 * A convenience over `simulateWhatIf`, not a second implementation: it builds the adjustments and
 * hands them over.
 */
export function uniformPriceShock(
  holdings: readonly Holding[],
  changePct: number,
): PriceAdjustment[] {
  return holdings.map((holding) => ({
    symbol: holding.symbol,
    market: holding.market,
    changePct,
  }))
}
