import { StatCard, StatGrid } from "@/components/stat-card"
import { Delta, Percent } from "@/components/value"
import { METRIC_REGISTRY, type MetricId } from "@/domain/personalization"
import { formatCurrency, formatCurrencyWithCode, formatPercent } from "@/lib/format"
import type { Currency } from "@/domain/market"

/**
 * The summary tiles, showing the metrics the user chose.
 *
 * **Every value here is read from the analytics bundle** — this component looks figures up, it does
 * not compute them. That is what keeps a "favourite metric" a display preference rather than a
 * second place a number can come from, and it is why the whole file contains no arithmetic beyond
 * one ratio that the bundle does not already carry.
 *
 * A metric that cannot be computed honestly renders **N/A**, never 0: a portfolio with no previous
 * close has an unknown change today, and a portfolio with no dividends has an unknown yield.
 */
export type MetricSource = {
  currency: Currency
  totalValue: number
  investedValue: number
  marketValue: number
  cashBalance: number
  unrealizedPnl: number
  realizedPnl: number
  returnPct: number
  todayPnl: number | null
  todayReturnPct: number | null
  holdingsCount: number
  dividendIncome: number | null
  yieldOnCost: number | null
  yieldOnValue: number | null
  largestWeightPct: number | null
}

const NA = <span className="text-muted-foreground text-lg">N/A</span>

export function MetricTiles({ metrics, source }: { metrics: readonly MetricId[]; source: MetricSource }) {
  return (
    <StatGrid>
      {metrics.map((id) => {
        const definition = METRIC_REGISTRY[id]
        return (
          <StatCard
            key={id}
            label={definition.label}
            emphasis
            // The definition is on the tile itself, as a title, so "Yield on cost" and "Yield on
            // current value" are distinguishable without leaving the page.
            value={<span title={definition.definition}>{renderValue(id, source)}</span>}
            hint={renderHint(id, source)}
          />
        )
      })}
    </StatGrid>
  )
}

function renderValue(id: MetricId, s: MetricSource): React.ReactNode {
  switch (id) {
    case "totalValue":
      // With the code, not just the symbol: this is the number a user quotes, and "825,420" or even
      // "฿825,420" is ambiguous on a screen that also shows dollars.
      return formatCurrencyWithCode(s.totalValue, s.currency)
    case "investedCapital":
      return formatCurrency(s.investedValue, s.currency)
    case "totalReturnPct":
      return <Percent value={s.returnPct} />
    case "todayChange":
      return s.todayPnl === null ? NA : <Delta value={s.todayPnl} currency={s.currency} />
    case "unrealizedPnl":
      return <Delta value={s.unrealizedPnl} currency={s.currency} />
    case "realizedPnl":
      return <Delta value={s.realizedPnl} currency={s.currency} />
    case "dividendIncome":
      return s.dividendIncome === null ? NA : formatCurrency(s.dividendIncome, s.currency)
    case "yieldOnCost":
      return s.yieldOnCost === null ? NA : formatPercent(s.yieldOnCost, { signed: false })
    case "yieldOnValue":
      return s.yieldOnValue === null ? NA : formatPercent(s.yieldOnValue, { signed: false })
    case "cashBalance":
      return formatCurrency(s.cashBalance, s.currency)
    case "cashRatio":
      // The one ratio the bundle does not already carry. Null rather than 0 for an empty portfolio:
      // a portfolio worth nothing does not hold 0% cash, it has no composition at all.
      return s.totalValue > 0
        ? formatPercent((s.cashBalance / s.totalValue) * 100, { signed: false })
        : NA
    case "largestPositionWeight":
      return s.largestWeightPct === null ? NA : formatPercent(s.largestWeightPct, { signed: false })
    case "positionCount":
      return String(s.holdingsCount)
  }
}

function renderHint(id: MetricId, s: MetricSource): React.ReactNode {
  switch (id) {
    case "totalValue":
      return (
        <span className="text-muted-foreground">
          {formatCurrency(s.marketValue, s.currency)} stocks · {formatCurrency(s.cashBalance, s.currency)} cash
        </span>
      )
    case "todayChange":
      return s.todayReturnPct === null ? (
        <span className="text-muted-foreground">No previous close</span>
      ) : (
        <Percent value={s.todayReturnPct} />
      )
    case "unrealizedPnl":
      return <Percent value={s.returnPct} />
    case "realizedPnl":
      return (
        <span className="text-muted-foreground">
          {s.holdingsCount} holding{s.holdingsCount === 1 ? "" : "s"}
        </span>
      )
    default:
      return <span className="text-muted-foreground text-xs">{METRIC_REGISTRY[id].definition}</span>
  }
}
