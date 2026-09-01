import type { Metadata } from "next"
import { Coins } from "lucide-react"
import { PaginationNav } from "@/components/pagination-nav"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Metric, Section } from "@/components/metric"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { EmptyState } from "@/components/empty-state"
import { DividendBars } from "@/features/analytics/components/charts"
import { loadAnalytics } from "@/features/analytics/portfolio-analytics"
import { DividendList } from "@/features/dividends/components/dividend-list"
import { listDividendsPage } from "@/features/dividends/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { formatCurrency, formatOptional, formatPercent } from "@/lib/format"
import { toPage } from "@/lib/pagination"
import { NoPortfolio } from "../_no-portfolio"

export const metadata: Metadata = { title: "Dividends" }

type Props = { searchParams: Promise<{ p?: string; page?: string; group?: string }> }

export default async function DividendsPage({ searchParams }: Props) {
  const { p, page: pageParam, group } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const grouping = group === "quarter" || group === "year" ? group : "month"
  const [bundle, pageResult] = await Promise.all([
    loadAnalytics(active.id, grouping),
    listDividendsPage(active.id, toPage(pageParam)),
  ])

  const currency = active.currency
  const { summary, byPeriod, bySymbol, yieldOnValue, yieldOnCost } = bundle.dividends

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Dividends</h1>
        <p className="text-muted-foreground text-sm">{active.name}</p>
      </div>

      {bundle.marketDataError && (
        <Alert>
          <AlertDescription>{bundle.marketDataError} Yields may be out of date.</AlertDescription>
        </Alert>
      )}

      <StatGrid>
        <StatCard
          label="Total received"
          value={formatCurrency(summary.totalNet, currency)}
          emphasis
          hint={
            <span className="text-muted-foreground">
              {summary.count} payment{summary.count === 1 ? "" : "s"}, net of tax
            </span>
          }
        />
        <StatCard
          label="This year"
          value={formatCurrency(summary.thisYear, currency)}
          emphasis
          hint={
            <span className="text-muted-foreground">
              {formatCurrency(summary.thisMonth, currency)} this month
            </span>
          }
        />
        <StatCard
          label="Last 12 months"
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
          label="Yield on value"
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
            title="Dividend income"
            description={`Net dividends received, by ${grouping}. The last 12 months is the basis for both yields above.`}
          >
            {byPeriod.length > 0 ? (
              <DividendBars periods={byPeriod} currency={currency} />
            ) : (
              <p className="text-muted-foreground py-8 text-center text-sm">Nothing to chart yet.</p>
            )}
          </Section>

          <Section title="By stock" description="Which holdings actually pay you.">
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
            title="No dividends yet"
            description="Record a payment and Stockly works out your income, yield on cost and yield on current value."
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
