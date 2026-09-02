import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Delta, Percent } from "@/components/value"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { AllocationChart } from "@/features/dashboard/components/lazy-allocation-chart"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { listAlerts } from "@/features/alerts/queries"
import { describeAlert } from "@/domain/alerts"
import { toRuleFromRow } from "@/features/alerts/to-rule"
import { loadIntelligence } from "@/features/intelligence/loader"
import { InsightList } from "@/features/intelligence/components/insight-list"
import { GoalProgressBar } from "@/features/goals/components/goal-progress-bar"
import { Section } from "@/components/metric"
import { namesFrom } from "@/features/portfolios/portfolio-view"
import { CurrencyExposure, CurrencyNotice, TranslationNote } from "@/components/currency-exposure"
import { baseCurrencyOf } from "@/domain/market"
import { formatCurrency, formatCurrencyWithCode } from "@/lib/format"
import { NoPortfolio } from "../_no-portfolio"

export const metadata: Metadata = { title: "Dashboard" }

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const { p } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  // One aggregation for the whole page: holdings, cash, dividends and fees come from a single pass
  // and a single batched quote call, so the dashboard cannot disagree with analytics.
  // `loadIntelligence` calls the same cached `loadAnalytics`, so goals, insights and risk cost no
  // extra pass over the transactions and no extra quote call.
  const [intelligence, alerts] = await Promise.all([
    loadIntelligence(active.id),
    listAlerts().catch(() => []),
  ])
  const bundle = intelligence.analytics
  const activeAlerts = alerts.filter((a) => a.enabled)
  const { holdings, summary, cash, totalValue, quotes, marketDataError, dividends, fees } = bundle
  const { missingFxPairs } = bundle
  const transactions = { length: bundle.transactionCount }
  const names = namesFrom(quotes)
  const currency = baseCurrencyOf(active.currency)
  const ranked = [...holdings].sort((a, b) => b.returnPct - a.returnPct)
  const best = ranked[0]
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Dashboard</h1>
          <p className="text-muted-foreground text-sm">{active.name}</p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href={`/transactions?p=${active.id}`} />}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          Transactions
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </div>

      {marketDataError ? (
        <Alert>
          <AlertDescription>
            {marketDataError} Holdings below are valued at cost until prices return.
          </AlertDescription>
        </Alert>
      ) : summary.staleCount > 0 ? (
        <Alert>
          <AlertDescription>
            No live price for {summary.staleCount} holding{summary.staleCount === 1 ? "" : "s"}; those
            are valued at cost.
          </AlertDescription>
        </Alert>
      ) : null}

      <CurrencyNotice summary={summary} missingFxPairs={missingFxPairs} />

      {transactions.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={TrendingUp}
            title="Nothing to show yet"
            description="Add your first transaction and your portfolio value, cost basis and profit and loss appear here."
            action={
              <Button
                nativeButton={false}
                render={<Link href={`/transactions?p=${active.id}`} />}
                className="gap-2 max-sm:h-11"
              >
                Add a transaction
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Portfolio value"
              // With the code, not just the symbol: this is the number a user quotes, and "825,420"
              // or even "฿825,420" is ambiguous on a screen that also shows dollars.
              value={formatCurrencyWithCode(totalValue, currency)}
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {formatCurrency(summary.marketValue, currency)} stocks ·{" "}
                  {formatCurrency(cash.balance, currency)} cash
                </span>
              }
            />
            <StatCard
              label="Today"
              value={
                summary.todayPnl === null ? (
                  <span className="text-muted-foreground text-lg">N/A</span>
                ) : (
                  <Delta value={summary.todayPnl} currency={currency} />
                )
              }
              emphasis
              hint={
                summary.todayReturnPct === null ? (
                  <span className="text-muted-foreground">No previous close</span>
                ) : (
                  <Percent value={summary.todayReturnPct} />
                )
              }
            />
            <StatCard
              label="Unrealized P&L"
              value={<Delta value={summary.unrealizedPnl} currency={currency} />}
              emphasis
              hint={<Percent value={summary.returnPct} />}
            />
            <StatCard
              label="Realized P&L"
              value={<Delta value={summary.realizedPnl} currency={currency} />}
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {summary.holdingsCount} holding{summary.holdingsCount === 1 ? "" : "s"}
                </span>
              }
            />
          </StatGrid>

          {/* The figures that are not P&L, kept out of the headline row so it stays readable. */}
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
            {[
              { label: "Invested capital", value: formatCurrency(summary.investedValue, currency) },
              { label: "Net contributed", value: formatCurrency(cash.netContributed, currency) },
              { label: "Dividends received", value: formatCurrency(dividends.summary.totalNet, currency) },
              { label: "Total fees", value: formatCurrency(fees.total, currency) },
            ].map((item) => (
              <div key={item.label} className="bg-card space-y-0.5 p-4">
                <dt className="text-muted-foreground text-xs">{item.label}</dt>
                <dd className="tabular font-semibold">{item.value}</dd>
              </div>
            ))}
          </dl>

          <CurrencyExposure summary={summary} />
          <TranslationNote summary={summary} />

          {/*
            Investment intelligence, kept to what is worth seeing without scrolling: the goals that
            are being tracked, and the three things most worth looking at. Everything deeper lives
            on the review page rather than turning the dashboard into a wall of cards.
          */}
          {(intelligence.goals.length > 0 || intelligence.insights.length > 0) && (
            <div className="grid gap-4 lg:grid-cols-2">
              {intelligence.goals.length > 0 && (
                <Section
                  title="Goals"
                  description="Measured from the same figures as everything above."
                  action={
                    <Button
                      nativeButton={false}
                      render={<Link href={`/goals?p=${active.id}`} />}
                      variant="outline"
                      size="sm"
                    >
                      Manage
                    </Button>
                  }
                >
                  <ul className="space-y-4">
                    {intelligence.goals.slice(0, 2).map(({ row, progress }) => (
                      <li key={row.id}>
                        <GoalProgressBar progress={progress} baseCurrency={currency} />
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section
                title="Worth a look"
                description="Facts about this portfolio, never advice."
                action={
                  <Button
                    nativeButton={false}
                    render={<Link href={`/review?p=${active.id}`} />}
                    variant="outline"
                    size="sm"
                  >
                    Full review
                  </Button>
                }
                className={intelligence.goals.length === 0 ? "lg:col-span-2" : undefined}
              >
                <InsightList insights={intelligence.insights} limit={3} />
              </Section>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="bg-card rounded-xl border p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold">Allocation</h2>
              {holdings.length ? (
                <AllocationChart holdings={holdings} currency={currency} />
              ) : (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No open positions to allocate.
                </p>
              )}
            </section>

            <section className="bg-card rounded-xl border p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold">Performance</h2>
              {best ? (
                <div className="grid gap-3">
                  {[
                    { label: "Best performer", holding: best, icon: TrendingUp },
                    ...(worst ? [{ label: "Worst performer", holding: worst, icon: TrendingDown }] : []),
                  ].map(({ label, holding, icon: Icon }) => (
                    <div
                      key={label}
                      className="bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2.5"
                    >
                      <Icon
                        className={label === "Best performer" ? "text-gain size-4" : "text-loss size-4"}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-muted-foreground text-xs">{label}</p>
                        <p className="font-medium">{holding.symbol}</p>
                      </div>
                      <div className="text-right">
                        <Percent value={holding.returnPct} />
                        <p className="text-muted-foreground tabular text-xs">
                          {formatCurrency(holding.marketValue, currency)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No open positions yet.
                </p>
              )}
            </section>
          </div>

          {activeAlerts.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {activeAlerts.length} active alert{activeAlerts.length === 1 ? "" : "s"}
                </h2>
                <Link
                  href="/alerts"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm underline-offset-4 hover:underline pointer-coarse:-my-2 pointer-coarse:min-h-11 pointer-coarse:py-2"
                >
                  Manage
                </Link>
              </div>
              <ul className="divide-y overflow-hidden rounded-xl border">
                {activeAlerts.slice(0, 4).map((alert) => (
                  <li key={alert.id} className="bg-card px-4 py-2.5 text-sm">
                    {describeAlert(toRuleFromRow(alert))}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Top holdings</h2>
              <Link
                href={`/portfolio?p=${active.id}`}
                className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm underline-offset-4 hover:underline pointer-coarse:-my-2 pointer-coarse:min-h-11 pointer-coarse:py-2"
              >
                View all
              </Link>
            </div>
            <ul className="divide-y overflow-hidden rounded-xl border">
              {holdings.slice(0, 5).map((h) => (
                <li key={h.symbol} className="bg-card flex items-center gap-3 px-4 py-3">
                  <Link href={`/stocks/${h.symbol}`} className="tap min-w-0 flex-1 flex-col !items-start">
                    <p className="font-medium underline-offset-4 hover:underline">{h.symbol}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {names[h.symbol] ?? `${h.quantity} @ ${formatCurrency(h.averageCost, currency)}`}
                    </p>
                  </Link>
                  <div className="text-right">
                    <p className="tabular font-medium">{formatCurrency(h.marketValue, currency)}</p>
                    <Delta value={h.unrealizedPnl} currency={currency} percent={h.returnPct} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
