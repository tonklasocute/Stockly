import { getTranslations } from "next-intl/server"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Delta, Percent } from "@/components/value"
import { type MetricId } from "@/domain/personalization"
import { formatCurrency, formatCurrencyWithCode, formatPercent } from "@/lib/format"
import type { Currency } from "@/domain/market"

/**
 * The translator, passed down rather than reached for.
 *
 * `renderValue` and `renderHint` are plain functions, not components, so they cannot call a hook
 * and cannot await anything. Handing them `t` keeps them pure and keeps the whole file readable as
 * "look up a figure, format it, label it" — which is the property this component exists to have.
 */
type T = Awaited<ReturnType<typeof getTranslations<"personalization">>>
type Tc = Awaited<ReturnType<typeof getTranslations<"common">>>

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

/* "N/A" is the same two letters in both languages — see `common.state.notApplicable`. */
const NA = <span className="text-muted-foreground text-lg">N/A</span>

export async function MetricTiles({
  metrics,
  source,
}: {
  metrics: readonly MetricId[]
  source: MetricSource
}) {
  const [t, tc] = await Promise.all([
    getTranslations("personalization"),
    getTranslations("common"),
  ])

  return (
    <StatGrid>
      {metrics.map((id) => (
        <StatCard
          key={id}
          label={t(`metrics.${id}.label`)}
          emphasis
          // The definition is on the tile itself, as a title, so "Yield on cost" and "Yield on
          // current value" are distinguishable without leaving the page.
          value={
            <span title={t(`metrics.${id}.definition`)}>{renderValue(id, source)}</span>
          }
          hint={renderHint(id, source, t, tc)}
        />
      ))}
    </StatGrid>
  )
}

/** Formats a figure and nothing else — no words, so no translator. */
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

function renderHint(id: MetricId, s: MetricSource, t: T, tc: Tc): React.ReactNode {
  switch (id) {
    case "totalValue":
      return (
        <span className="text-muted-foreground">
          {tc("terms.stocksAndCash", {
            stocks: formatCurrency(s.marketValue, s.currency),
            cash: formatCurrency(s.cashBalance, s.currency),
          })}
        </span>
      )
    case "todayChange":
      return s.todayReturnPct === null ? (
        <span className="text-muted-foreground">{tc("state.noPreviousClose")}</span>
      ) : (
        <Percent value={s.todayReturnPct} />
      )
    case "unrealizedPnl":
      return <Percent value={s.returnPct} />
    case "realizedPnl":
      // ICU, not a ternary: Thai has one plural form and English has two.
      return (
        <span className="text-muted-foreground">
          {tc("terms.holdingCount", { count: s.holdingsCount })}
        </span>
      )
    default:
      return <span className="text-muted-foreground text-xs">{t(`metrics.${id}.definition`)}</span>
  }
}
