import { add, multiply, percentOf, subtract, sumBy } from "./money"
import type { Currency } from "./market"

export type DomainDividend = {
  symbol: string
  /**
   * The currency the payment arrived in. Stored, not derived: a listing can pay in a currency other
   * than the one it trades in, so the market cannot answer this.
   */
  currency: Currency
  /** The date the cash arrived; every period bucket is keyed on this. */
  paidOn: string
  shares: number
  dividendPerShare: number
  tax: number
  fee: number
}

export type DividendAmounts = {
  gross: number
  tax: number
  fee: number
  net: number
}

/**
 *   gross = shares × dividend per share
 *   net   = gross − withholding tax − fee
 *
 * Net is what reaches the cash balance, so it is what every yield and total below is computed from.
 * Gross is kept because a user reconciling against a broker statement needs to see both.
 */
/** Only the four numbers matter here, so a caller rendering one row need not build a whole dividend. */
export function dividendAmounts(
  dividend: Pick<DomainDividend, "shares" | "dividendPerShare" | "tax" | "fee">,
): DividendAmounts {
  const gross = multiply(dividend.shares, dividend.dividendPerShare)
  return {
    gross,
    tax: dividend.tax,
    fee: dividend.fee,
    net: subtract(gross, add(dividend.tax, dividend.fee)),
  }
}

export type DividendPeriod = {
  /** "2026-03" for a month, "2026-Q1" for a quarter, "2026" for a year. */
  key: string
  label: string
  gross: number
  net: number
  count: number
}

export type PeriodGrouping = "month" | "quarter" | "year"

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function bucketOf(isoDate: string, grouping: PeriodGrouping): { key: string; label: string } {
  const year = isoDate.slice(0, 4)
  const month = Number(isoDate.slice(5, 7))
  if (grouping === "year") return { key: year, label: year }
  if (grouping === "quarter") {
    const quarter = Math.floor((month - 1) / 3) + 1
    return { key: `${year}-Q${quarter}`, label: `Q${quarter} ${year}` }
  }
  return {
    key: `${year}-${isoDate.slice(5, 7)}`,
    label: `${MONTH_NAMES[month - 1] ?? "?"} ${year}`,
  }
}

/** Buckets sorted oldest first, with empty periods omitted rather than charted as zero. */
export function groupDividends(
  dividends: readonly DomainDividend[],
  grouping: PeriodGrouping,
): DividendPeriod[] {
  const buckets = new Map<string, DividendPeriod>()

  for (const dividend of dividends) {
    const { key, label } = bucketOf(dividend.paidOn, grouping)
    const amounts = dividendAmounts(dividend)
    const bucket = buckets.get(key) ?? { key, label, gross: 0, net: 0, count: 0 }
    bucket.gross = add(bucket.gross, amounts.gross)
    bucket.net = add(bucket.net, amounts.net)
    bucket.count += 1
    buckets.set(key, bucket)
  }

  return [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export type DividendBySymbol = {
  symbol: string
  gross: number
  net: number
  count: number
  /** Share of total net dividend income. */
  weight: number
}

export function dividendsBySymbol(dividends: readonly DomainDividend[]): DividendBySymbol[] {
  const bySymbol = new Map<string, DividendBySymbol>()

  for (const dividend of dividends) {
    const symbol = dividend.symbol.toUpperCase()
    const amounts = dividendAmounts(dividend)
    const row = bySymbol.get(symbol) ?? { symbol, gross: 0, net: 0, count: 0, weight: 0 }
    row.gross = add(row.gross, amounts.gross)
    row.net = add(row.net, amounts.net)
    row.count += 1
    bySymbol.set(symbol, row)
  }

  const total = sumBy(bySymbol.values(), (row) => row.net)
  return [...bySymbol.values()]
    .map((row) => ({ ...row, weight: total > 0 ? (percentOf(row.net, total) ?? 0) : 0 }))
    .sort((a, b) => b.net - a.net)
}

export type DividendSummary = {
  totalNet: number
  totalGross: number
  totalTax: number
  thisMonth: number
  thisYear: number
  /** Net dividends over the last 365 days — the numerator for both yields below. */
  trailingTwelveMonths: number
  /**
   * Average per month over the months actually covered by the history, not over 12. A portfolio
   * three months old would otherwise report an average a quarter of its real rate.
   */
  averageMonthly: number | null
  monthsCovered: number
  count: number
}

const DAY_MS = 86_400_000

export function summarizeDividends(
  dividends: readonly DomainDividend[],
  today: Date = new Date(),
): DividendSummary {
  const todayIso = today.toISOString().slice(0, 10)
  const currentMonth = todayIso.slice(0, 7)
  const currentYear = todayIso.slice(0, 4)
  const twelveMonthsAgo = new Date(today.getTime() - 365 * DAY_MS).toISOString().slice(0, 10)

  const amountOf = (d: DomainDividend) => dividendAmounts(d)

  const paidDates = dividends.map((d) => d.paidOn).sort()
  const first = paidDates[0]
  const monthsCovered = first
    ? Math.max(
        1,
        (today.getUTCFullYear() - Number(first.slice(0, 4))) * 12 +
          (today.getUTCMonth() + 1 - Number(first.slice(5, 7))) +
          1,
      )
    : 0

  const totalNet = sumBy(dividends, (d) => amountOf(d).net)

  return {
    totalNet,
    totalGross: sumBy(dividends, (d) => amountOf(d).gross),
    totalTax: sumBy(dividends, (d) => add(d.tax, d.fee)),
    thisMonth: sumBy(
      dividends.filter((d) => d.paidOn.slice(0, 7) === currentMonth),
      (d) => amountOf(d).net,
    ),
    thisYear: sumBy(
      dividends.filter((d) => d.paidOn.slice(0, 4) === currentYear),
      (d) => amountOf(d).net,
    ),
    trailingTwelveMonths: sumBy(
      dividends.filter((d) => d.paidOn > twelveMonthsAgo && d.paidOn <= todayIso),
      (d) => amountOf(d).net,
    ),
    averageMonthly: monthsCovered > 0 ? totalNet / monthsCovered : null,
    monthsCovered,
    count: dividends.length,
  }
}

/**
 * Two different yields with two different denominators. They are never both "dividend yield":
 * calling them by one name is how a portfolio appears to yield 9% when it yields 3%.
 *
 *   Yield on current value = trailing 12m net dividends / current market value × 100
 *   Yield on cost          = trailing 12m net dividends / original cost basis  × 100
 *
 * Both use trailing actual payments, never a forward estimate — Stockly does not forecast.
 * Null when the denominator is zero, because "no yield yet" is not "a yield of zero".
 */
export function computeYields(
  trailingTwelveMonthsNet: number,
  marketValue: number,
  investedValue: number,
): { yieldOnValue: number | null; yieldOnCost: number | null } {
  return {
    yieldOnValue: percentOf(trailingTwelveMonthsNet, marketValue),
    yieldOnCost: percentOf(trailingTwelveMonthsNet, investedValue),
  }
}
