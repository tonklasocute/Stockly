import { add, divide, multiply, percentOf, subtract, sumBy, QUANTITY_SCALE } from "./money"
import { currencyOf, symbolKey, type Currency, type MarketId } from "./market"
import { identityConverter, type Converter } from "./fx"
import type {
  CurrencyExposure,
  DomainTransaction,
  Holding,
  HoldingFx,
  PortfolioSummary,
  Position,
  PricePoint,
  RealizedTrade,
} from "./types"

/**
 * Cost basis method: weighted average cost.
 *
 * Buy  -> quantity += q, investedValue += q * price + fee
 * Sell -> realized  += (q * price - fee) - averageCost * q, then both are reduced by that share.
 *
 * Fees are part of the cost basis on a buy and reduce the proceeds on a sell, which is how retail
 * brokers report it. FIFO, if it is ever needed for tax purposes, belongs beside this function
 * rather than replacing it.
 *
 * **The replay is currency-blind by design.** Every transaction for one instrument is in that
 * instrument's own currency, so averaging cost across them is always an apples-to-apples sum and no
 * FX rate is involved. Currency enters exactly once, in `priceHoldings`, where today's value is
 * translated into the portfolio's base currency — and never retroactively, which is why a past
 * trade's numbers can never move because a rate did.
 */

function chronological(a: DomainTransaction, b: DomainTransaction): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1
  return (a.sequence ?? 0) - (b.sequence ?? 0)
}

/** Rows written before phase 9 carry no market; the column defaults to US and so does this. */
function marketOfTransaction(tx: DomainTransaction): MarketId {
  return tx.market ?? "US"
}

/**
 * One pass over the transactions, producing both the positions and a record of every realization.
 *
 * Positions are keyed by market **and** symbol: the same three letters can be a listing in New York
 * and a different company in Bangkok, and merging them would average two unrelated cost bases into
 * one meaningless number.
 *
 * A "trade" here is a sell: the moment profit or loss is booked. Under weighted-average cost that is
 * the only point at which a gain becomes real, so it is the only honest unit for win rate and
 * average-win statistics.
 */
export function replayPortfolio(transactions: readonly DomainTransaction[]): {
  positions: Position[]
  trades: RealizedTrade[]
} {
  const byInstrument = new Map<string, Position>()
  const trades: RealizedTrade[] = []
  /** When the current run of ownership began, so a closed position's hold time is exact. */
  const openedAt = new Map<string, string>()

  for (const tx of [...transactions].sort(chronological)) {
    const symbol = tx.symbol.toUpperCase()
    const market = marketOfTransaction(tx)
    const key = symbolKey(symbol, market)
    const p =
      byInstrument.get(key) ??
      {
        symbol,
        market,
        currency: currencyOf(market),
        quantity: 0,
        investedValue: 0,
        averageCost: 0,
        realizedPnl: 0,
      }

    if (tx.side === "buy") {
      if (p.quantity === 0) openedAt.set(key, tx.tradeDate)
      p.quantity = add(p.quantity, tx.quantity, QUANTITY_SCALE)
      p.investedValue = add(p.investedValue, add(multiply(tx.quantity, tx.price), tx.fee))
    } else {
      // Selling more than is held is rejected at the boundary; clamp so a bad row cannot
      // produce a negative position that silently corrupts every later number.
      const sold = Math.min(tx.quantity, p.quantity)
      // Closing the position releases the exact remaining basis, so no float dust is left behind.
      const costOut = sold === p.quantity ? p.investedValue : multiply(p.averageCost, sold)
      const proceeds = subtract(multiply(sold, tx.price), tx.fee)
      const pnl = subtract(proceeds, costOut)
      p.realizedPnl = add(p.realizedPnl, pnl)
      p.quantity = subtract(p.quantity, sold, QUANTITY_SCALE)
      p.investedValue = subtract(p.investedValue, costOut)

      // A sell of zero shares (nothing held) is not a trade and must not skew the win rate.
      if (sold > 0) {
        const opened = openedAt.get(key)
        trades.push({
          symbol,
          market,
          currency: p.currency,
          soldOn: tx.tradeDate,
          openedOn: opened ?? null,
          quantity: sold,
          proceeds,
          costBasis: costOut,
          realizedPnl: pnl,
          returnPct: percentOf(pnl, costOut),
          // Exact only when the whole run of ownership closed here; a partial sell has no single
          // purchase date under weighted-average cost, so it reports null rather than a guess.
          holdingDays: opened && p.quantity === 0 ? daysBetween(opened, tx.tradeDate) : null,
        })
      }
      if (p.quantity === 0) openedAt.delete(key)
    }

    p.averageCost = p.quantity > 0 ? divide(p.investedValue, p.quantity, QUANTITY_SCALE) : 0
    if (p.quantity === 0) p.investedValue = 0
    byInstrument.set(key, p)
  }

  return { positions: [...byInstrument.values()], trades }
}

export function computePositions(transactions: readonly DomainTransaction[]): Position[] {
  return replayPortfolio(transactions).positions
}

/** Whole days between two ISO dates, in UTC, so a timezone never shifts a holding period. */
function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from.slice(0, 10)}T00:00:00Z`)
  const end = Date.parse(`${to.slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(start) || Number.isNaN(end)) return 0
  return Math.max(0, Math.round((end - start) / 86_400_000))
}

/** Shares of `symbol` on `market` held after replaying `transactions`. */
export function heldQuantity(
  transactions: readonly DomainTransaction[],
  symbol: string,
  market: MarketId = "US",
): number {
  const key = symbolKey(symbol, market)
  return (
    computePositions(transactions).find((p) => symbolKey(p.symbol, p.market) === key)?.quantity ?? 0
  )
}

/**
 * Whether a sell is covered by the shares held at that point in time. When re-checking an edit,
 * the caller passes the other transactions with the edited one already removed.
 *
 * Scoped to the instrument, market included: holding PTT on SET does not let you sell a US ticker
 * that happens to spell the same letters.
 */
export function canSell(
  transactions: readonly DomainTransaction[],
  candidate: DomainTransaction,
): { ok: true } | { ok: false; available: number } {
  const market = marketOfTransaction(candidate)
  const key = symbolKey(candidate.symbol, market)
  const priorTo = transactions
    .filter((t) => symbolKey(t.symbol, marketOfTransaction(t)) === key)
    .filter((t) => chronological(t, candidate) <= 0)

  const available = heldQuantity(priorTo, candidate.symbol, market)
  return candidate.quantity <= available ? { ok: true } : { ok: false, available }
}

/** How a portfolio is valued: in which currency, using which rates, as of when. */
export type ValuationOptions = {
  /** The portfolio's base currency. Defaults to USD, which is what every pre-phase-9 row implies. */
  baseCurrency?: Currency
  /**
   * Turns an amount in an instrument's currency into the base currency, or returns null when no
   * rate is available. Defaults to the identity converter: same currency passes through, anything
   * else is honestly unknown rather than silently wrong.
   */
  convert?: Converter
}

function toHoldingFx(conversion: { rate: number; asOf: string | null; freshness: HoldingFx["freshness"]; identity: boolean }): HoldingFx {
  return {
    rate: conversion.rate,
    asOf: conversion.asOf,
    freshness: conversion.freshness,
    identity: conversion.identity,
  }
}

export function priceHoldings(
  positions: readonly Position[],
  quoteOf: (symbol: string, market: MarketId) => PricePoint | undefined,
  options: ValuationOptions = {},
): Holding[] {
  const baseCurrency = options.baseCurrency ?? "USD"
  const convert = options.convert ?? identityConverter(baseCurrency)

  const open = positions.filter((p) => p.quantity > 0)
  const priced = open.map((p) => {
    const quote = quoteOf(p.symbol, p.market)
    // No quote (unknown symbol, or the provider is down): fall back to cost, which shows a flat
    // position rather than a fabricated loss, and flag it so the UI can say the price is stale.
    const stale = quote === undefined
    const currentPrice = quote?.price ?? p.averageCost
    const marketValue = multiply(p.quantity, currentPrice)
    const unrealizedPnl = subtract(marketValue, p.investedValue)
    // Today's move needs yesterday's close; without it the number is unknown, not zero.
    const todayPnl =
      quote?.previousClose !== undefined
        ? multiply(p.quantity, subtract(currentPrice, quote.previousClose))
        : null

    // One rate per holding, applied to every figure. Asking the converter five times cannot give
    // five different rates — they all come from the same table entry — but doing it once means the
    // rate reported to the user is provably the one the numbers were computed with.
    const conversion = convert(marketValue, p.currency)
    const fx = conversion ? toHoldingFx(conversion) : null
    const toBase = (value: number | null): number | null =>
      fx === null || value === null ? null : multiply(value, fx.rate)

    return {
      ...p,
      currentPrice,
      marketValue,
      unrealizedPnl,
      returnPct: p.investedValue > 0 ? (percentOf(unrealizedPnl, p.investedValue) ?? 0) : 0,
      weight: null as number | null,
      todayPnl,
      todayReturnPct:
        quote?.previousClose !== undefined && quote.previousClose > 0
          ? percentOf(subtract(currentPrice, quote.previousClose), quote.previousClose)
          : null,
      stale,
      baseCurrency,
      fx,
      baseMarketValue: conversion ? conversion.value : null,
      baseInvestedValue: toBase(p.investedValue),
      baseUnrealizedPnl: toBase(unrealizedPnl),
      baseTodayPnl: toBase(todayPnl),
      baseRealizedPnl: toBase(p.realizedPnl),
    }
  })

  // Weight is a share of the portfolio, so it is only meaningful once every holding is expressed in
  // the same currency. A holding with no rate has no knowable share — null, not zero.
  const total = sumBy(priced, (h) => h.baseMarketValue ?? 0)
  return priced
    .map((h) => ({
      ...h,
      weight:
        h.baseMarketValue === null || total <= 0 ? null : (percentOf(h.baseMarketValue, total) ?? 0),
    }))
    .sort((a, b) => (b.baseMarketValue ?? b.marketValue) - (a.baseMarketValue ?? a.marketValue))
}

/** One row per currency held, so a mixed portfolio can say what it is actually exposed to. */
export function currencyExposures(holdings: readonly Holding[]): CurrencyExposure[] {
  const byCurrency = new Map<Currency, Holding[]>()
  for (const holding of holdings) {
    const bucket = byCurrency.get(holding.currency)
    if (bucket) bucket.push(holding)
    else byCurrency.set(holding.currency, [holding])
  }

  const translatable = sumBy(holdings, (h) => h.baseMarketValue ?? 0)
  return [...byCurrency.entries()]
    .map(([currency, group]) => {
      const untranslated = group.some((h) => h.baseMarketValue === null)
      const baseValue = untranslated ? null : sumBy(group, (h) => h.baseMarketValue ?? 0)
      return {
        currency,
        nativeValue: sumBy(group, (h) => h.marketValue),
        baseValue,
        weight:
          baseValue === null || translatable <= 0 ? null : (percentOf(baseValue, translatable) ?? 0),
        holdings: group.length,
        fx: group.find((h) => h.fx !== null)?.fx ?? null,
      }
    })
    .sort((a, b) => (b.baseValue ?? 0) - (a.baseValue ?? 0))
}

/**
 * The portfolio total, **in the base currency**.
 *
 * Only translatable holdings are summed. Mixing a baht figure into a dollar total to avoid an
 * awkward `untranslatedCount` would produce a number that is not money in any currency; reporting
 * the count instead lets the page say "2 holdings could not be converted" and stay truthful.
 *
 * Realized P&L is translated at today's rate, like everything else here. For a single-currency
 * portfolio that is exact. For a mixed one it is a translation of a past result at a present rate —
 * useful, and clearly labelled as such in the UI — which is also precisely why `fxEffect` is null
 * rather than a number: separating currency movement from stock performance needs the rate on every
 * trade date, and Stockly stores none.
 */
export function summarize(
  positions: readonly Position[],
  holdings: readonly Holding[],
  options: ValuationOptions = {},
): PortfolioSummary {
  const baseCurrency = options.baseCurrency ?? holdings[0]?.baseCurrency ?? "USD"
  const convert = options.convert ?? identityConverter(baseCurrency)

  const translated = holdings.filter((h) => h.baseMarketValue !== null)
  const marketValue = sumBy(translated, (h) => h.baseMarketValue ?? 0)
  const investedValue = sumBy(translated, (h) => h.baseInvestedValue ?? 0)
  const unrealizedPnl = subtract(marketValue, investedValue)

  // Realized P&L lives on positions, not holdings: a position closed last year still contributed.
  const realizedPnl = sumBy(positions, (p) => convert(p.realizedPnl, p.currency)?.value ?? 0)

  // Only the holdings with a previous close contribute; if none do, today's move is unknown rather
  // than a misleading zero. The percentage is against yesterday's value of those same holdings.
  const withToday = translated.filter((h) => h.baseTodayPnl !== null)
  const todayPnl = withToday.length ? sumBy(withToday, (h) => h.baseTodayPnl ?? 0) : null
  const yesterdayValue = sumBy(withToday, (h) =>
    subtract(h.baseMarketValue ?? 0, h.baseTodayPnl ?? 0),
  )

  return {
    currency: baseCurrency,
    marketValue,
    investedValue,
    unrealizedPnl,
    realizedPnl,
    returnPct: investedValue > 0 ? (percentOf(unrealizedPnl, investedValue) ?? 0) : 0,
    holdingsCount: holdings.length,
    todayPnl,
    todayReturnPct:
      todayPnl !== null && yesterdayValue > 0 ? percentOf(todayPnl, yesterdayValue) : null,
    staleCount: holdings.filter((h) => h.stale).length,
    untranslatedCount: holdings.length - translated.length,
    fxStaleCount: holdings.filter((h) => h.fx?.freshness === "stale").length,
    exposures: currencyExposures(holdings),
    fxEffect: null,
  }
}

/** One call for the common case: transactions + quotes in, everything the UI needs out. */
export function buildPortfolio(
  transactions: readonly DomainTransaction[],
  quoteOf: (symbol: string, market: MarketId) => PricePoint | undefined,
  options: ValuationOptions = {},
): { positions: Position[]; holdings: Holding[]; summary: PortfolioSummary } {
  const positions = computePositions(transactions)
  const holdings = priceHoldings(positions, quoteOf, options)
  return { positions, holdings, summary: summarize(positions, holdings, options) }
}
