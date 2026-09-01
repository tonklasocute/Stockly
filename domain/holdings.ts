import type {
  DomainTransaction,
  Holding,
  PortfolioSummary,
  Position,
  PricePoint,
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

export function computePositions(transactions: readonly DomainTransaction[]): Position[] {
  const bySymbol = new Map<string, Position>()

  for (const tx of [...transactions].sort(chronological)) {
    const symbol = tx.symbol.toUpperCase()
    const p =
      bySymbol.get(symbol) ??
      { symbol, quantity: 0, investedValue: 0, averageCost: 0, realizedPnl: 0 }

    if (tx.side === "buy") {
      p.quantity += tx.quantity
      p.investedValue += tx.quantity * tx.price + tx.fee
    } else {
      // Selling more than is held is rejected at the boundary; clamp so a bad row cannot
      // produce a negative position that silently corrupts every later number.
      const sold = Math.min(tx.quantity, p.quantity)
      // Closing the position releases the exact remaining basis, so no float dust is left behind.
      const costOut = sold === p.quantity ? p.investedValue : p.averageCost * sold
      p.realizedPnl += sold * tx.price - tx.fee - costOut
      p.quantity -= sold
      p.investedValue -= costOut
    }

    p.averageCost = p.quantity > 0 ? p.investedValue / p.quantity : 0
    if (p.quantity === 0) p.investedValue = 0
    bySymbol.set(symbol, p)
  }

  return [...bySymbol.values()]
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
    const marketValue = p.quantity * currentPrice
    const unrealizedPnl = marketValue - p.investedValue
    // Today's move needs yesterday's close; without it the number is unknown, not zero.
    const todayPnl =
      quote?.previousClose !== undefined ? p.quantity * (currentPrice - quote.previousClose) : null
    return {
      ...p,
      currentPrice,
      marketValue,
      unrealizedPnl,
      returnPct: p.investedValue > 0 ? (unrealizedPnl / p.investedValue) * 100 : 0,
      weight: 0,
      todayPnl,
      todayReturnPct:
        quote?.previousClose !== undefined && quote.previousClose > 0
          ? ((currentPrice - quote.previousClose) / quote.previousClose) * 100
          : null,
      stale,
    }
  })

  const total = priced.reduce((sum, h) => sum + h.marketValue, 0)
  return priced
    .map((h) => ({ ...h, weight: total > 0 ? (h.marketValue / total) * 100 : 0 }))
    .sort((a, b) => b.marketValue - a.marketValue)
}

export function summarize(
  positions: readonly Position[],
  holdings: readonly Holding[],
): PortfolioSummary {
  const marketValue = holdings.reduce((s, h) => s + h.marketValue, 0)
  const investedValue = holdings.reduce((s, h) => s + h.investedValue, 0)
  const unrealizedPnl = marketValue - investedValue

  // Only the holdings with a previous close contribute; if none do, today's move is unknown rather
  // than a misleading zero. The percentage is against yesterday's value of those same holdings.
  const withToday = holdings.filter((h) => h.todayPnl !== null)
  const todayPnl = withToday.length ? withToday.reduce((s, h) => s + (h.todayPnl ?? 0), 0) : null
  const yesterdayValue = withToday.reduce((s, h) => s + (h.marketValue - (h.todayPnl ?? 0)), 0)

  return {
    marketValue,
    investedValue,
    unrealizedPnl,
    realizedPnl: positions.reduce((s, p) => s + p.realizedPnl, 0),
    returnPct: investedValue > 0 ? (unrealizedPnl / investedValue) * 100 : 0,
    holdingsCount: holdings.length,
    todayPnl,
    todayReturnPct:
      todayPnl !== null && yesterdayValue > 0 ? (todayPnl / yesterdayValue) * 100 : null,
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
