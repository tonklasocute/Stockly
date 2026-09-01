import { add, divide, multiply, percentOf, subtract, sumBy, QUANTITY_SCALE } from "./money"
import type {
  DomainTransaction,
  Holding,
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
 */

function chronological(a: DomainTransaction, b: DomainTransaction): number {
  if (a.tradeDate !== b.tradeDate) return a.tradeDate < b.tradeDate ? -1 : 1
  return (a.sequence ?? 0) - (b.sequence ?? 0)
}

/**
 * One pass over the transactions, producing both the positions and a record of every realization.
 *
 * A "trade" here is a sell: the moment profit or loss is booked. Under weighted-average cost that is
 * the only point at which a gain becomes real, so it is the only honest unit for win rate and
 * average-win statistics.
 */
export function replayPortfolio(transactions: readonly DomainTransaction[]): {
  positions: Position[]
  trades: RealizedTrade[]
} {
  const bySymbol = new Map<string, Position>()
  const trades: RealizedTrade[] = []
  /** When the current run of ownership began, so a closed position's hold time is exact. */
  const openedAt = new Map<string, string>()

  for (const tx of [...transactions].sort(chronological)) {
    const symbol = tx.symbol.toUpperCase()
    const p =
      bySymbol.get(symbol) ??
      { symbol, quantity: 0, investedValue: 0, averageCost: 0, realizedPnl: 0 }

    if (tx.side === "buy") {
      if (p.quantity === 0) openedAt.set(symbol, tx.tradeDate)
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
        const opened = openedAt.get(symbol)
        trades.push({
          symbol,
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
      if (p.quantity === 0) openedAt.delete(symbol)
    }

    p.averageCost = p.quantity > 0 ? divide(p.investedValue, p.quantity, QUANTITY_SCALE) : 0
    if (p.quantity === 0) p.investedValue = 0
    bySymbol.set(symbol, p)
  }

  return { positions: [...bySymbol.values()], trades }
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

/** Shares of `symbol` held after replaying `transactions`. */
export function heldQuantity(
  transactions: readonly DomainTransaction[],
  symbol: string,
): number {
  return computePositions(transactions).find((p) => p.symbol === symbol.toUpperCase())?.quantity ?? 0
}

/**
 * Whether a sell is covered by the shares held at that point in time. When re-checking an edit,
 * the caller passes the other transactions with the edited one already removed.
 */
export function canSell(
  transactions: readonly DomainTransaction[],
  candidate: DomainTransaction,
): { ok: true } | { ok: false; available: number } {
  const symbol = candidate.symbol.toUpperCase()
  const priorTo = transactions
    .filter((t) => t.symbol.toUpperCase() === symbol)
    .filter((t) => chronological(t, candidate) <= 0)

  const available = heldQuantity(priorTo, symbol)
  return candidate.quantity <= available ? { ok: true } : { ok: false, available }
}

export function priceHoldings(
  positions: readonly Position[],
  quoteOf: (symbol: string) => PricePoint | undefined,
): Holding[] {
  const open = positions.filter((p) => p.quantity > 0)
  const priced = open.map((p) => {
    const quote = quoteOf(p.symbol)
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
    return {
      ...p,
      currentPrice,
      marketValue,
      unrealizedPnl,
      returnPct: p.investedValue > 0 ? (percentOf(unrealizedPnl, p.investedValue) ?? 0) : 0,
      weight: 0,
      todayPnl,
      todayReturnPct:
        quote?.previousClose !== undefined && quote.previousClose > 0
          ? percentOf(subtract(currentPrice, quote.previousClose), quote.previousClose)
          : null,
      stale,
    }
  })

  const total = sumBy(priced, (h) => h.marketValue)
  return priced
    .map((h) => ({ ...h, weight: total > 0 ? (percentOf(h.marketValue, total) ?? 0) : 0 }))
    .sort((a, b) => b.marketValue - a.marketValue)
}

export function summarize(
  positions: readonly Position[],
  holdings: readonly Holding[],
): PortfolioSummary {
  const marketValue = sumBy(holdings, (h) => h.marketValue)
  const investedValue = sumBy(holdings, (h) => h.investedValue)
  const unrealizedPnl = subtract(marketValue, investedValue)

  // Only the holdings with a previous close contribute; if none do, today's move is unknown rather
  // than a misleading zero. The percentage is against yesterday's value of those same holdings.
  const withToday = holdings.filter((h) => h.todayPnl !== null)
  const todayPnl = withToday.length ? sumBy(withToday, (h) => h.todayPnl ?? 0) : null
  const yesterdayValue = sumBy(withToday, (h) => subtract(h.marketValue, h.todayPnl ?? 0))

  return {
    marketValue,
    investedValue,
    unrealizedPnl,
    realizedPnl: sumBy(positions, (p) => p.realizedPnl),
    returnPct: investedValue > 0 ? (percentOf(unrealizedPnl, investedValue) ?? 0) : 0,
    holdingsCount: holdings.length,
    todayPnl,
    todayReturnPct: todayPnl !== null && yesterdayValue > 0 ? percentOf(todayPnl, yesterdayValue) : null,
    staleCount: holdings.filter((h) => h.stale).length,
  }
}

/** One call for the common case: transactions + quotes in, everything the UI needs out. */
export function buildPortfolio(
  transactions: readonly DomainTransaction[],
  quoteOf: (symbol: string) => PricePoint | undefined,
): { positions: Position[]; holdings: Holding[]; summary: PortfolioSummary } {
  const positions = computePositions(transactions)
  const holdings = priceHoldings(positions, quoteOf)
  return { positions, holdings, summary: summarize(positions, holdings) }
}
