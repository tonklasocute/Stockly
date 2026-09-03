import type { Metadata } from "next"
import { Coins } from "lucide-react"
import { PaginationNav } from "@/components/pagination-nav"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Metric, Section } from "@/components/metric"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/empty-state"
import { DividendBars } from "@/features/analytics/components/lazy-charts"
import { loadAnalytics } from "@/features/analytics/portfolio-analytics"
import { DividendList } from "@/features/dividends/components/dividend-list"
import { listDividendsPage } from "@/features/dividends/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { baseCurrencyOf } from "@/domain/market"
import { formatCurrency, formatOptional, formatPercent } from "@/lib/format"
import { toPage } from "@/lib/pagination"
import { NoPortfolio } from "../_no-portfolio"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("dividends") }
}

type Props = { searchParams: Promise<{ p?: string; page?: string; group?: string }> }

export default async function DividendsPage({ searchParams }: Props) {
  const tNav = await getTranslations("navigation")
  const t = await getTranslations("dividends")
  const { p, page: pageParam, group } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const grouping = group === "quarter" || group === "year" ? group : "month"
  const [bundle, pageResult] = await Promise.all([
    loadAnalytics(active.id, grouping),
    listDividendsPage(active.id, toPage(pageParam)),
  ])

  const currency = baseCurrencyOf(active.currency)
  const { summary, byPeriod, bySymbol, yieldOnValue, yieldOnCost } = bundle.dividends

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("dividends")}</h1>
        <p className="text-muted-foreground text-sm">{active.name}</p>
      </div>

      {bundle.marketDataError && (
        <Alert>
          <AlertDescription>{bundle.marketDataError} Yields may be out of date.</AlertDescription>
        </Alert>
      )}

      <StatGrid>
        <StatCard
          label={t("summary.totalReceived")}
          value={formatCurrency(summary.totalNet, currency)}
          emphasis
          hint={
            <span className="text-muted-foreground">
              {summary.count} payment{summary.count === 1 ? "" : "s"}, net of tax
            </span>
          }
        />
        <StatCard
          label={t("summary.thisYear")}
          value={formatCurrency(summary.thisYear, currency)}
          emphasis
          hint={
            <span className="text-muted-foreground">
              {formatCurrency(summary.thisMonth, currency)} this month
            </span>
          }
        />
        <StatCard
          label={t("summary.last12Months")}
          value={formatCurrency(summary.trailingTwelveMonths, currency)}
          emphasis
          hint={
            <span className="text-muted-foreground">
              {summary.averageMonthly === null
                ? "No history yet"
                : `${formatCurrency(summary.averageMonthly, currency)} average / month`}
            </span>
          }
        />
        {/* Two yields, two denominators, two labels — never both called "dividend yield". */}
        <StatCard
          label={t("summary.yieldOnValue")}
          value={formatOptional(yieldOnValue, (v) => formatPercent(v, { signed: false }))}
          emphasis
          hint={
            <span className="text-muted-foreground">
              {formatOptional(yieldOnCost, (v) => formatPercent(v, { signed: false }))} on cost
            </span>
          }
        />
      </StatGrid>

      {summary.count > 0 && (
        <>
          <Section
            title={t("summary.income")}
            description={`Net dividends received, by ${grouping}. The last 12 months is the basis for both yields above.`}
          >
            {byPeriod.length > 0 ? (
              <DividendBars periods={byPeriod} currency={currency} />
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">{t("chartEmpty")}</p>
            )}
          </Section>

          <Section title={t("byStock.title")} description={t("byStock.hint")}>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {bySymbol.slice(0, 9).map((row) => (
                <Metric
                  key={row.symbol}
                  label={row.symbol}
                  value={formatCurrency(row.net, currency)}
                  hint={`${formatPercent(row.weight, { signed: false })} of income · ${row.count} payment${row.count === 1 ? "" : "s"}`}
                />
              ))}
            </dl>
          </Section>
        </>
      )}

      {summary.count === 0 && pageResult.total === 0 && (
        <div className="rounded-xl border">
          <EmptyState
            icon={Coins}
            title={t("empty.title")}
            description={t("empty.body")}
          />
        </div>
      )}

      <DividendList dividends={pageResult.rows} portfolioId={active.id} currency={currency} />

      <PaginationNav
        page={pageResult.page}
        pageCount={pageResult.pageCount}
        total={pageResult.total}
        baseParams={{ p: active.id, group }}
        label="dividends"
      />
    </div>
  )
}
