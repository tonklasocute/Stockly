import type { Metadata } from "next"
import Link from "next/link"
import { Metric, Section } from "@/components/metric"
import { Delta, Percent } from "@/components/value"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/empty-state"
import { History } from "lucide-react"
import { AttributionPanel } from "@/features/history/components/attribution-panel"
import { loadHistory } from "@/features/history/loader"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { HISTORY_PERIODS, type HistoryPeriod } from "@/domain/history"
import { describeDrawdown } from "@/domain/drawdown-history"
import { formatCurrency, formatDate, formatOptionalPercent } from "@/lib/format"
import { NoPortfolio } from "../../_no-portfolio"
import { appLocale } from "@/lib/i18n/server"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("history") }
}

/** The nonce-based CSP needs a server-rendered response; a prerendered page carries no nonce. */
export const dynamic = "force-dynamic"

/**
 * How the portfolio got here.
 *
 * Everything on this page is **derived on read** from the transaction set and the snapshot series.
 * There is no stored return, contribution or drawdown, so correcting a transaction from March
 * corrects March — which is what it means for the transaction to be the source of truth.
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; period?: string }>
}) {
  const tNav = await getTranslations("navigation")
  const tEnum = await getTranslations("enums")
  const t = await getTranslations("history")
  const locale = await appLocale()
  const { p, period: requested } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const period = (HISTORY_PERIODS as readonly string[]).includes(requested ?? "")
    ? (requested as HistoryPeriod)
    : "1Y"

  const history = await loadHistory(active.id, period)
  const { baseCurrency: currency } = history

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("history")}</h1>
          <p className="text-muted-foreground text-sm">{active.name}</p>
        </div>
        <nav aria-label={t("period")} className="flex flex-wrap gap-1">
          {HISTORY_PERIODS.map((option) => (
            <Link
              key={option}
              href={`/portfolio/history?p=${active.id}&period=${option}`}
              aria-current={option === period ? "page" : undefined}
              className={`rounded-md border px-2.5 py-1 text-xs pointer-coarse:min-h-11 pointer-coarse:px-3 ${
                option === period ? "bg-foreground text-background" : "hover:bg-muted"
              }`}
            >
              {option}
            </Link>
          ))}
        </nav>
      </header>

      {history.points.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={History}
            title={t("empty.title")}
            description={t("empty.body")}
          />
        </div>
      ) : (
        <>
          <Section
            title={t("returnAndValue")}
            description={`${tEnum(`historyPeriod.${period}`)} · ${history.coverage.snapshots} readings`}
          >
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {/*
                Three different numbers, named so they cannot be read as one another. The value
                change includes money paid in; the returns do not.
              */}
              <Metric
                label={t("twr")}
                value={formatOptionalPercent(history.timeWeightedReturnPct)}
                hint="Capital flows removed"
              />
              <Metric
                label={t("mwr")}
                value={formatOptionalPercent(history.moneyWeightedReturnPct)}
                hint="What this investor earned"
              />
              <Metric
                label={t("valueChange")}
                value={
                  history.valueChange === null ? (
                    <span className="text-muted-foreground">N/A</span>
                  ) : (
                    <Delta value={history.valueChange} currency={currency} />
                  )
                }
                hint="Not a return — includes money paid in"
              />
              <Metric
                label={t("netCapitalFlow")}
                value={<Delta value={history.netFlow} currency={currency} />}
                hint={`${history.flows.length} movement${history.flows.length === 1 ? "" : "s"}`}
              />
            </dl>

            {history.coverage.completeSnapshots < history.coverage.snapshots && (
              <p className="text-muted-foreground mt-3 text-xs">
                {history.coverage.snapshots - history.coverage.completeSnapshots} of{" "}
                {history.coverage.snapshots} readings in this period are partial or were valued from
                an earlier date.
              </p>
            )}
          </Section>

          <AttributionPanel
            attribution={history.attribution}
            residual={history.attributionResidual}
            contributors={history.contributors.contributors}
            detractors={history.contributors.detractors}
            currency={currency}
          />

          <Section
            title={t("drawdowns")}
            description={
              history.regime ? tEnum(`regime.${history.regime}`) : "Not enough history to measure"
            }
          >
            {history.drawdowns === null ? (
              <p className="text-muted-foreground text-sm">
                Measured once there are enough daily readings. A handful of observations has a
                lowest point, but calling it a drawdown history implies a history that does not
                exist.
              </p>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Metric
                    label={t("deepestFall")}
                    value={
                      history.drawdowns.worst
                        ? `${history.drawdowns.worst.depthPct.toFixed(1)}%`
                        : "None"
                    }
                  />
                  <Metric
                    label={t("currentlyBelowHigh")}
                    value={`${history.drawdowns.currentDepthPct.toFixed(1)}%`}
                  />
                  <Metric label={t("observations")} value={String(history.drawdowns.observations)} />
                </dl>

                {history.drawdowns.events.length > 0 && (
                  <ul className="mt-4 divide-y">
                    {history.drawdowns.events.map((event) => (
                      <li
                        key={`${event.peakDate}-${event.troughDate}`}
                        className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm"
                      >
                        <span>{describeDrawdown(event)}</span>
                        {event.ongoing ? <Badge variant="secondary">{t("ongoing")}</Badge> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Section>

          <Section title={t("byMonth")} description={t("flowsRemoved")}>
            {/* A table above `sm`, a list below: twelve columns do not belong on a phone. */}
            <ul className="divide-y">
              {history.monthly.map((row) => (
                <li
                  key={row.month}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm"
                >
                  <span className="font-medium">{row.month}</span>
                  <div className="tabular text-muted-foreground flex items-baseline gap-4">
                    {row.dividends > 0 && <span>{formatCurrency(row.dividends, currency)} income</span>}
                    {row.netFlow !== 0 && (
                      <span>{formatCurrency(row.netFlow, currency)} flow</span>
                    )}
                    <span className="w-16 text-right">
                      {row.returnPct === null ? (
                        <span title={t("noValuationThisMonth")}>N/A</span>
                      ) : (
                        <Percent value={row.returnPct} />
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </Section>

          <Section title={t("activityAndCosts")}>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric
                label={t("bought")}
                value={formatCurrency(history.turnover.buyVolume, currency)}
                hint={`${history.turnover.orderCount} orders`}
              />
              <Metric label={t("sold")} value={formatCurrency(history.turnover.sellVolume, currency)} />
              <Metric
                label={t("turnover")}
                value={formatOptionalPercent(history.turnover.ratio, { signed: false })}
                hint="Of average portfolio value"
              />
              <Metric
                label={t("fees")}
                value={formatCurrency(history.fees.total, currency)}
                hint={
                  history.fees.ofTradingVolume === null
                    ? "N/A of traded value"
                    : `${history.fees.ofTradingVolume.toFixed(2)}% of traded value`
                }
              />
            </dl>
          </Section>

          <p className="text-muted-foreground text-xs">
            Every figure here describes what has already happened and is derived from your
            transactions each time this page is opened. Past performance is not a guide to future
            performance.
            {history.points.length > 0 &&
              ` Readings from ${formatDate(history.points[0].date, locale)} to ${formatDate(history.points[history.points.length - 1].date, locale)}.`}
          </p>
        </>
      )}
    </div>
  )
}
