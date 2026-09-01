import { add, divide, percentOf, roundTo, subtract, sumBy } from "./money"
import type { DomainTransaction, Holding, RealizedTrade } from "./types"

// ---------------------------------------------------------------- allocation

export type AllocationSlice = {
  key: string
  label: string
  value: number
  /** Percent of the total, 0–100. */
  weight: number
}

/**
 * Total portfolio value is stock market value plus cash, so allocation always sums to 100% with
 * cash as a first-class slice. A portfolio that is 40% cash is a fact about the portfolio, not a
 * rounding artefact to be hidden.
 */
export function allocateByHolding(holdings: readonly Holding[], cash: number): AllocationSlice[] {
  const total = add(sumBy(holdings, (h) => h.marketValue), Math.max(cash, 0))
  const slices = holdings.map((h) => ({
    key: h.symbol,
    label: h.symbol,
    value: h.marketValue,
    weight: total > 0 ? (percentOf(h.marketValue, total) ?? 0) : 0,
  }))

  if (cash > 0) {
    slices.push({
      key: "__cash",
      label: "Cash",
      value: cash,
      weight: total > 0 ? (percentOf(cash, total) ?? 0) : 0,
    })
  }
  return slices.sort((a, b) => b.value - a.value)
}

/** Metadata the provider may or may not have for a symbol. Missing is normal, not an error. */
export type SymbolFacts = {
  sector?: string | null
  industry?: string | null
  country?: string | null
  currency?: string | null
}

const UNKNOWN = "Unknown"

/**
 * Groups holdings by one metadata field. Symbols the provider knows nothing about land in
 * "Unknown" rather than being dropped — a chart that silently omits 30% of a portfolio is a lie.
 */
export function allocateBy(
  holdings: readonly Holding[],
  factOf: (symbol: string) => SymbolFacts | undefined,
  field: keyof SymbolFacts,
): AllocationSlice[] {
  const total = sumBy(holdings, (h) => h.marketValue)
  const buckets = new Map<string, number>()

  for (const holding of holdings) {
    const raw = factOf(holding.symbol)?.[field]
    const key = raw && String(raw).trim() ? String(raw).trim() : UNKNOWN
    buckets.set(key, add(buckets.get(key) ?? 0, holding.marketValue))
  }

  return [...buckets.entries()]
    .map(([key, value]) => ({
      key,
      label: key,
      value,
      weight: total > 0 ? (percentOf(value, total) ?? 0) : 0,
    }))
    // Unknown always sorts last, however large, so it never leads the chart.
    .sort((a, b) => (a.key === UNKNOWN ? 1 : b.key === UNKNOWN ? -1 : b.value - a.value))
}

/** True when the provider gave nothing for this field, so the UI can hide the section entirely. */
export function isAllUnknown(slices: readonly AllocationSlice[]): boolean {
  return slices.length > 0 && slices.every((s) => s.key === UNKNOWN)
}

// ---------------------------------------------------------------- concentration

export type Concentration = {
  largest: { symbol: string; weight: number } | null
  top3Weight: number
  top5Weight: number
  positionCount: number
  /** Cash as a share of total portfolio value. */
  cashWeight: number
  /**
   * Informational only. Stockly never tells anyone what to buy or sell; it states what the numbers
   * are and lets the user draw the conclusion.
   */
  level: "diversified" | "moderate" | "concentrated"
}

export function computeConcentration(
  holdings: readonly Holding[],
  cash: number,
): Concentration {
  const slices = allocateByHolding(holdings, cash).filter((s) => s.key !== "__cash")
  const cashSlice = allocateByHolding(holdings, cash).find((s) => s.key === "__cash")
  const byWeight = [...slices].sort((a, b) => b.weight - a.weight)

  const topN = (n: number) => roundTo(sumBy(byWeight.slice(0, n), (s) => s.weight), 2)
  const largestWeight = byWeight[0]?.weight ?? 0

  return {
    largest: byWeight[0] ? { symbol: byWeight[0].key, weight: roundTo(largestWeight, 2) } : null,
    top3Weight: topN(3),
    top5Weight: topN(5),
    positionCount: holdings.length,
    cashWeight: roundTo(cashSlice?.weight ?? 0, 2),
    // Thresholds are conventional rules of thumb, stated as description, never as advice.
    level: largestWeight >= 40 || topN(3) >= 70 ? "concentrated" : largestWeight >= 25 ? "moderate" : "diversified",
  }
}

// ---------------------------------------------------------------- movers

export type Mover = {
  symbol: string
  pnl: number
  returnPct: number
}

/** Ranked by percentage return since purchase, which compares positions of different sizes fairly. */
export function topMovers(
  holdings: readonly Holding[],
  limit = 5,
): { gainers: Mover[]; losers: Mover[] } {
  const rows = holdings.map((h) => ({
    symbol: h.symbol,
    pnl: h.unrealizedPnl,
    returnPct: h.returnPct,
  }))
  const sorted = [...rows].sort((a, b) => b.returnPct - a.returnPct)

  return {
    gainers: sorted.filter((r) => r.pnl > 0).slice(0, limit),
    losers: sorted
      .filter((r) => r.pnl < 0)
      .sort((a, b) => a.returnPct - b.returnPct)
      .slice(0, limit),
  }
}

/** Today's movers need a previous close; holdings without one are excluded, not treated as flat. */
export function todayMovers(
  holdings: readonly Holding[],
  limit = 5,
): { gainers: Mover[]; losers: Mover[] } | null {
  const withToday = holdings.filter((h) => h.todayPnl !== null && h.todayReturnPct !== null)
  if (withToday.length === 0) return null

  const rows = withToday.map((h) => ({
    symbol: h.symbol,
    pnl: h.todayPnl ?? 0,
    returnPct: h.todayReturnPct ?? 0,
  }))
  const sorted = [...rows].sort((a, b) => b.returnPct - a.returnPct)

  return {
    gainers: sorted.filter((r) => r.pnl > 0).slice(0, limit),
    losers: sorted
      .filter((r) => r.pnl < 0)
      .sort((a, b) => a.returnPct - b.returnPct)
      .slice(0, limit),
  }
}

// ---------------------------------------------------------------- contribution

export type Contribution = {
  symbol: string
  realized: number
  unrealized: number
  total: number
  /**
   * Share of the portfolio's total P&L. The denominator is the sum of absolute contributions, not
   * the net total: with +$500 and −$500 the net is zero, and dividing by it would produce infinities
   * instead of "each position accounts for half the movement".
   */
  weight: number
}

export function computeContribution(
  holdings: readonly Holding[],
  trades: readonly RealizedTrade[],
): Contribution[] {
  const bySymbol = new Map<string, Contribution>()

  const row = (symbol: string) =>
    bySymbol.get(symbol) ?? { symbol, realized: 0, unrealized: 0, total: 0, weight: 0 }

  for (const trade of trades) {
    const current = row(trade.symbol)
    current.realized = add(current.realized, trade.realizedPnl)
    bySymbol.set(trade.symbol, current)
  }
  for (const holding of holdings) {
    const current = row(holding.symbol)
    current.unrealized = add(current.unrealized, holding.unrealizedPnl)
    bySymbol.set(holding.symbol, current)
  }

  const rows = [...bySymbol.values()].map((r) => ({ ...r, total: add(r.realized, r.unrealized) }))
  const absTotal = sumBy(rows, (r) => Math.abs(r.total))

  return rows
    .map((r) => ({ ...r, weight: absTotal > 0 ? (percentOf(r.total, absTotal) ?? 0) : 0 }))
    .sort((a, b) => b.total - a.total)
}

// ---------------------------------------------------------------- realized P&L statistics

export type TradeStatistics = {
  totalTrades: number
  buyOrders: number
  sellOrders: number
  winningTrades: number
  losingTrades: number
  breakEvenTrades: number
  /** Percent of decided trades that were profitable. Null when nothing has been sold yet. */
  winRate: number | null
  averageWin: number | null
  averageLoss: number | null
  best: RealizedTrade | null
  worst: RealizedTrade | null
  totalRealized: number
  /**
   * Average holding period, over closed positions only. Weighted-average cost keeps no lot history,
   * so a partial sell has no single purchase date — those are excluded rather than estimated.
   */
  averageHoldDays: number | null
  closedPositionCount: number
}

/**
 * Definitions, fixed here so the UI and the docs cannot drift apart:
 *   trade        = one sell that released cost basis
 *   winning      = realized P&L > 0     losing = < 0     break-even = exactly 0
 *   win rate     = winning / (winning + losing) × 100   — break-even trades decide nothing and are
 *                  excluded from the denominator rather than counted as losses
 */
export function computeTradeStatistics(
  transactions: readonly DomainTransaction[],
  trades: readonly RealizedTrade[],
): TradeStatistics {
  const wins = trades.filter((t) => t.realizedPnl > 0)
  const losses = trades.filter((t) => t.realizedPnl < 0)
  const decided = wins.length + losses.length
  const closed = trades.filter((t) => t.holdingDays !== null)

  const byPnl = [...trades].sort((a, b) => b.realizedPnl - a.realizedPnl)

  return {
    totalTrades: trades.length,
    buyOrders: transactions.filter((t) => t.side === "buy").length,
    sellOrders: transactions.filter((t) => t.side === "sell").length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    breakEvenTrades: trades.length - decided,
    winRate: decided > 0 ? percentOf(wins.length, decided) : null,
    averageWin: wins.length > 0 ? divide(sumBy(wins, (t) => t.realizedPnl), wins.length) : null,
    averageLoss: losses.length > 0 ? divide(sumBy(losses, (t) => t.realizedPnl), losses.length) : null,
    best: byPnl[0] ?? null,
    worst: byPnl.length > 1 ? byPnl[byPnl.length - 1] : null,
    totalRealized: sumBy(trades, (t) => t.realizedPnl),
    averageHoldDays:
      closed.length > 0
        ? Math.round(sumBy(closed, (t) => t.holdingDays ?? 0) / closed.length)
        : null,
    closedPositionCount: closed.length,
  }
}

// ---------------------------------------------------------------- fees

export type FeeStatistics = {
  total: number
  thisMonth: number
  thisYear: number
  bySymbol: Array<{ symbol: string; total: number; count: number }>
  /** Fees as a share of everything bought and sold — the number that shows what trading costs. */
  percentOfTurnover: number | null
}

export function computeFees(
  transactions: readonly DomainTransaction[],
  today: Date = new Date(),
): FeeStatistics {
  const iso = today.toISOString().slice(0, 10)
  const bySymbol = new Map<string, { symbol: string; total: number; count: number }>()

  for (const tx of transactions) {
    if (tx.fee <= 0) continue
    const symbol = tx.symbol.toUpperCase()
    const row = bySymbol.get(symbol) ?? { symbol, total: 0, count: 0 }
    row.total = add(row.total, tx.fee)
    row.count += 1
    bySymbol.set(symbol, row)
  }

  const total = sumBy(transactions, (t) => t.fee)
  const turnover = sumBy(transactions, (t) => t.quantity * t.price)

  return {
    total,
    thisMonth: sumBy(
      transactions.filter((t) => t.tradeDate.slice(0, 7) === iso.slice(0, 7)),
      (t) => t.fee,
    ),
    thisYear: sumBy(
      transactions.filter((t) => t.tradeDate.slice(0, 4) === iso.slice(0, 4)),
      (t) => t.fee,
    ),
    bySymbol: [...bySymbol.values()].sort((a, b) => b.total - a.total),
    percentOfTurnover: percentOf(total, turnover),
  }
}

// ---------------------------------------------------------------- capital and performance

export type CapitalPoint = {
  date: string
  /** Cost basis of everything held on that date, fees included. */
  investedValue: number
  /** Cumulative booked profit and loss up to that date. */
  realizedPnl: number
}

/**
 * Invested capital over time, reconstructed from transactions alone. No market data is involved, so
 * this series is exact and available from the very first transaction — unlike portfolio value, which
 * needs a price for every past day and therefore comes from snapshots.
 */
export function investedCapitalSeries(transactions: readonly DomainTransaction[]): CapitalPoint[] {
  const sorted = [...transactions].sort((a, b) =>
    a.tradeDate === b.tradeDate ? (a.sequence ?? 0) - (b.sequence ?? 0) : a.tradeDate < b.tradeDate ? -1 : 1,
  )

  const points: CapitalPoint[] = []
  const cost = new Map<string, { quantity: number; invested: number }>()
  let realized = 0

  for (const tx of sorted) {
    const symbol = tx.symbol.toUpperCase()
    const position = cost.get(symbol) ?? { quantity: 0, invested: 0 }

    if (tx.side === "buy") {
      position.quantity += tx.quantity
      position.invested = add(position.invested, add(tx.quantity * tx.price, tx.fee))
    } else {
      const sold = Math.min(tx.quantity, position.quantity)
      const averageCost = position.quantity > 0 ? position.invested / position.quantity : 0
      const costOut = sold === position.quantity ? position.invested : averageCost * sold
      realized = add(realized, subtract(subtract(sold * tx.price, tx.fee), costOut))
      position.quantity -= sold
      position.invested = subtract(position.invested, costOut)
    }
    cost.set(symbol, position)

    const investedValue = sumBy(cost.values(), (p) => p.invested)
    const last = points[points.length - 1]
    // One point per day: several trades on the same date collapse into their end-of-day state.
    if (last?.date === tx.tradeDate) {
      last.investedValue = investedValue
      last.realizedPnl = realized
    } else {
      points.push({ date: tx.tradeDate, investedValue, realizedPnl: realized })
    }
  }

  return points
}

export type PerformancePoint = {
  date: string
  totalValue: number
  investedValue: number
  /** totalValue − investedValue: profit at that moment, ignoring how much was contributed. */
  gain: number
  gainPct: number | null
}

export type PortfolioSnapshot = {
  date: string
  totalValue: number
  investedValue: number
  cashValue: number
  realizedPnl: number
  unrealizedPnl: number
}

/**
 * Portfolio value over time, from stored snapshots.
 *
 * Deliberately NOT "value on day N minus value on day 1": a $10,000 deposit raises the value by
 * $10,000 without earning a cent. Each point reports the gain over the invested capital recorded in
 * that same snapshot, so contributions move both sides of the subtraction and cancel out.
 */
export function performanceSeries(snapshots: readonly PortfolioSnapshot[]): PerformancePoint[] {
  return [...snapshots]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((snapshot) => {
      const gain = subtract(snapshot.totalValue, add(snapshot.investedValue, snapshot.cashValue))
      return {
        date: snapshot.date,
        totalValue: snapshot.totalValue,
        investedValue: snapshot.investedValue,
        gain,
        gainPct: percentOf(gain, snapshot.investedValue),
      }
    })
}

export type TimeRange = "1W" | "1M" | "3M" | "6M" | "YTD" | "1Y" | "3Y" | "5Y" | "MAX"

export const TIME_RANGES: readonly TimeRange[] = ["1W", "1M", "3M", "6M", "YTD", "1Y", "3Y", "5Y", "MAX"]

/** Parses a range from a URL. Pure, so a Server Component can call it. */
export function toTimeRange(value: string | undefined, fallback: TimeRange = "1Y"): TimeRange {
  return TIME_RANGES.includes(value as TimeRange) ? (value as TimeRange) : fallback
}

/** The inclusive start date for a range, or null for MAX. Shared by every dated view. */
export function rangeStart(range: TimeRange, today: Date = new Date()): string | null {
  if (range === "MAX") return null
  if (range === "YTD") return `${today.getUTCFullYear()}-01-01`

  const days: Record<Exclude<TimeRange, "MAX" | "YTD">, number> = {
    "1W": 7,
    "1M": 30,
    "3M": 91,
    "6M": 182,
    "1Y": 365,
    "3Y": 1095,
    "5Y": 1825,
  }
  return new Date(today.getTime() - days[range] * 86_400_000).toISOString().slice(0, 10)
}

export function withinRange<T extends { date?: string; paidOn?: string; tradeDate?: string }>(
  items: readonly T[],
  range: TimeRange,
  today: Date = new Date(),
): T[] {
  const start = rangeStart(range, today)
  if (!start) return [...items]
  return items.filter((item) => (item.date ?? item.paidOn ?? item.tradeDate ?? "") >= start)
}
