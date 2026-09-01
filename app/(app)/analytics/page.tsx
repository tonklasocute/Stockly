import type { Metadata } from "next"
import Link from "next/link"
import { BarChart3, Info, TrendingDown, TrendingUp } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Metric, Section } from "@/components/metric"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Delta, Percent } from "@/components/value"
import { toTimeRange, withinRange, type TimeRange } from "@/domain/analytics"
import { RangeFilter } from "@/components/range-filter"
import { AllocationDonut, PerformanceChart } from "@/features/analytics/components/lazy-charts"
import { AllocationTable } from "@/features/analytics/components/allocation-table"
import { ExportMenu } from "@/features/analytics/components/export-menu"
import { loadAnalytics, recordSnapshot } from "@/features/analytics/portfolio-analytics"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { formatCurrency, formatOptional, formatPercent } from "@/lib/format"
import { getUser } from "@/lib/supabase/server"
import { NoPortfolio } from "../_no-portfolio"

export const metadata: Metadata = { title: "Analytics" }

type Props = { searchParams: Promise<{ p?: string; range?: string }> }

const CONCENTRATION_TEXT: Record<string, string> = {
  concentrated: "This portfolio is concentrated in a few positions.",
  moderate: "This portfolio has a moderately large single position.",
  diversified: "This portfolio is spread across its positions.",
}

export default async function AnalyticsPage({ searchParams }: Props) {
  const { p, range: rangeParam } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const range: TimeRange = toTimeRange(rangeParam)
  const bundle = await loadAnalytics(active.id)
  const currency = active.currency

  // Write-on-read: the quotes were fetched to render this page, so capturing today's value costs
  // nothing extra. See recordSnapshot for why this beats a cron on a free-tier provider.
  //
  // Best-effort by design: losing one day of history is a far smaller failure than refusing to
  // render analytics because a snapshot write hiccuped.
  try {
    const user = await getUser()
    if (user) await recordSnapshot(active.id, user.id, bundle)
  } catch (error) {
    console.error("[analytics] snapshot skipped", error)
  }

  const {
    summary,
    cash,
    totalValue,
    allocation,
    sectors,
    industries,
    countries,
    currencies,
    hasSectorData,
    hasIndustryData,
    concentration,
    movers,
    today,
    contribution,
    tradeStats,
    fees,
    dividends,
    performance,
  } = bundle

  const performanceInRange = withinRange(performance, range)
  const totalPnl = summary.unrealizedPnl + summary.realizedPnl

  if (bundle.transactionCount === 0) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Analytics</h1>
        <div className="rounded-xl border">
          <EmptyState
            icon={BarChart3}
            title="Nothing to analyse yet"
            description="Record a transaction and this page fills in with allocation, performance, contribution and trade statistics."
            action={
              <Button
                nativeButton={false}
                render={<Link href={`/transactions?p=${active.id}`} />}
                className="max-sm:h-11"
              >
                Add a transaction
              </Button>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Analytics</h1>
          <p className="text-muted-foreground text-sm">{active.name}</p>
        </div>
        <ExportMenu portfolioId={active.id} />
      </div>

      {bundle.marketDataError && (
        <Alert>
          <AlertDescription>
            {bundle.marketDataError} Figures below are based on cost until prices return.
          </AlertDescription>
        </Alert>
      )}

      {/* 1. The headline numbers. */}
      <StatGrid>
        <StatCard
          label="Portfolio value"
          value={formatCurrency(totalValue, currency)}
          emphasis
          hint={
            <span className="text-muted-foreground">
              {formatCurrency(summary.marketValue, currency)} stocks ·{" "}
              {formatCurrency(cash.balance, currency)} cash
            </span>
          }
        />
        <StatCard
          label="Total P&L"
          value={<Delta value={totalPnl} currency={currency} />}
          emphasis
          hint={<Percent value={summary.returnPct} />}
        />
        <StatCard
          label="Unrealized"
          value={<Delta value={summary.unrealizedPnl} currency={currency} />}
          emphasis
          hint={
            <span className="text-muted-foreground">
              on {formatCurrency(summary.investedValue, currency)} invested
            </span>
          }
        />
        <StatCard
          label="Realized"
          value={<Delta value={summary.realizedPnl} currency={currency} />}
          emphasis
          hint={
            <span className="text-muted-foreground">
              {formatCurrency(dividends.summary.totalNet, currency)} dividends
            </span>
          }
        />
      </StatGrid>

      {/* 2. Performance over time. */}
      <Section
        title="Performance"
        description="Portfolio value against invested capital. Deposits raise both lines, so they never look like a return."
        action={<RangeFilter current={range} />}
      >
        {performanceInRange.length > 1 ? (
          <PerformanceChart points={performanceInRange} currency={currency} />
        ) : (
          <div className="text-muted-foreground flex items-start gap-2.5 rounded-lg border border-dashed px-4 py-6 text-sm">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
            <p>
              Value history is recorded once a day, starting the first time you open this page. Come
              back tomorrow and the chart begins to fill in. Your invested capital and P&amp;L above
              are exact from your first transaction — they need no history.
            </p>
          </div>
        )}
      </Section>

      {/* 3. Allocation and concentration. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Allocation" description="Stocks and cash as a share of total value.">
          <AllocationDonut slices={allocation} currency={currency} />
        </Section>

        <Section
          title="Concentration"
          description="Informational only — Stockly describes your portfolio, it does not advise on it."
        >
          <dl className="grid grid-cols-2 gap-3">
            <Metric
              label="Largest position"
              value={
                concentration.largest
                  ? `${concentration.largest.symbol} · ${formatPercent(concentration.largest.weight, { signed: false })}`
                  : "N/A"
              }
            />
            <Metric label="Positions" value={String(concentration.positionCount)} />
            <Metric
              label="Top 3"
              value={formatPercent(concentration.top3Weight, { signed: false })}
            />
            <Metric
              label="Top 5"
              value={formatPercent(concentration.top5Weight, { signed: false })}
            />
          </dl>
          <p className="text-muted-foreground mt-4 border-t pt-3 text-sm">
            {CONCENTRATION_TEXT[concentration.level]}{" "}
            {concentration.cashWeight > 0 &&
              `Cash is ${formatPercent(concentration.cashWeight, { signed: false })} of total value.`}
          </p>
        </Section>
      </div>

      {(hasSectorData || hasIndustryData) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {hasSectorData && (
            <Section title="By sector" description="Grouped from company profiles.">
              <AllocationTable slices={sectors} currency={currency} label="Sector" />
            </Section>
          )}
          {hasIndustryData && (
            <Section title="By industry">
              <AllocationTable slices={industries} currency={currency} label="Industry" />
            </Section>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="By country" description="Geographic exposure, from company profiles.">
          <AllocationTable slices={countries} currency={currency} label="Country" />
        </Section>
        <Section
          title="Currency exposure"
          description="Reported as held. Stockly does not convert between currencies."
        >
          <AllocationTable slices={currencies} currency={currency} label="Currency" />
        </Section>
      </div>

      {/* 4. Winners and losers. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Top gainers" description="By return since purchase.">
          <MoverList movers={movers.gainers} currency={currency} tone="gain" />
        </Section>
        <Section title="Top losers" description="By return since purchase.">
          <MoverList movers={movers.losers} currency={currency} tone="loss" />
        </Section>
      </div>

      {today && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Today's gainers">
            <MoverList movers={today.gainers} currency={currency} tone="gain" />
          </Section>
          <Section title="Today's losers">
            <MoverList movers={today.losers} currency={currency} tone="loss" />
          </Section>
        </div>
      )}

      {/* 5. Attribution. */}
      <Section
        title="P&L contribution"
        description="What each holding contributed, split into booked and on-paper profit."
      >
        <ul className="divide-y">
          {contribution.slice(0, 10).map((row) => (
            <li key={row.symbol} className="flex items-center gap-3 py-2.5">
              <span className="w-16 shrink-0 font-medium">{row.symbol}</span>
              <span className="text-muted-foreground min-w-0 flex-1 truncate text-xs">
                {formatCurrency(row.realized, currency)} realized ·{" "}
                {formatCurrency(row.unrealized, currency)} unrealized
              </span>
              <span className="text-right">
                <Delta value={row.total} currency={currency} />
                <span className="text-muted-foreground tabular block text-xs">
                  {formatPercent(row.weight)} of movement
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      {/* 6. Trading statistics. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Realized P&L"
          description="A trade is one sell. Break-even trades are excluded from the win rate."
        >
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Metric
              label="Win rate"
              value={formatOptional(tradeStats.winRate, (v) => formatPercent(v, { signed: false }))}
              hint={`${tradeStats.winningTrades} of ${tradeStats.winningTrades + tradeStats.losingTrades} decided`}
            />
            <Metric label="Winning trades" value={String(tradeStats.winningTrades)} />
            <Metric label="Losing trades" value={String(tradeStats.losingTrades)} />
            <Metric
              label="Average win"
              value={formatOptional(tradeStats.averageWin, (v) => formatCurrency(v, currency))}
            />
            <Metric
              label="Average loss"
              value={formatOptional(tradeStats.averageLoss, (v) => formatCurrency(v, currency))}
            />
            <Metric
              label="Total realized"
              value={formatCurrency(tradeStats.totalRealized, currency)}
            />
            <Metric
              label="Best trade"
              value={
                tradeStats.best
                  ? `${tradeStats.best.symbol} ${formatCurrency(tradeStats.best.realizedPnl, currency)}`
                  : "N/A"
              }
            />
            <Metric
              label="Worst trade"
              value={
                tradeStats.worst
                  ? `${tradeStats.worst.symbol} ${formatCurrency(tradeStats.worst.realizedPnl, currency)}`
                  : "N/A"
              }
            />
            <Metric
              label="Average hold"
              value={
                tradeStats.averageHoldDays === null
                  ? "N/A"
                  : `${tradeStats.averageHoldDays} days`
              }
              hint={
                tradeStats.averageHoldDays === null
                  ? "Needs a closed position"
                  : `${tradeStats.closedPositionCount} closed`
              }
            />
          </dl>
        </Section>

        <Section title="Fees" description="What trading has cost, in money rather than in feel.">
          <dl className="grid grid-cols-2 gap-3">
            <Metric label="Total fees" value={formatCurrency(fees.total, currency)} />
            <Metric
              label="Of turnover"
              value={formatOptional(fees.percentOfTurnover, (v) =>
                formatPercent(v, { signed: false }),
              )}
            />
            <Metric label="This month" value={formatCurrency(fees.thisMonth, currency)} />
            <Metric label="This year" value={formatCurrency(fees.thisYear, currency)} />
          </dl>
          {fees.bySymbol.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t pt-3 text-sm">
              {fees.bySymbol.slice(0, 5).map((row) => (
                <li key={row.symbol} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">
                    {row.symbol} · {row.count} order{row.count === 1 ? "" : "s"}
                  </span>
                  <span className="tabular">{formatCurrency(row.total, currency)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* 7. Dividend summary, with the detail one click away. */}
      <Section
        title="Dividend income"
        description="Two yields with two denominators — they are not interchangeable."
        action={
          <Button
            nativeButton={false}
            render={<Link href={`/dividends?p=${active.id}`} />}
            variant="outline"
            size="sm"
          >
            All dividends
          </Button>
        }
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            label="Received (all time)"
            value={formatCurrency(dividends.summary.totalNet, currency)}
          />
          <Metric
            label="Last 12 months"
            value={formatCurrency(dividends.summary.trailingTwelveMonths, currency)}
          />
          <Metric
            label="Yield on current value"
            value={formatOptional(dividends.yieldOnValue, (v) => formatPercent(v, { signed: false }))}
            hint="12m dividends ÷ market value"
          />
          <Metric
            label="Yield on cost"
            value={formatOptional(dividends.yieldOnCost, (v) => formatPercent(v, { signed: false }))}
            hint="12m dividends ÷ cost basis"
          />
        </dl>
      </Section>

      <p className="text-muted-foreground text-xs">
        Sector, industry and country groupings come from your market data provider; holdings it has
        no profile for are grouped as Unknown rather than dropped.
        {summary.staleCount > 0 &&
          ` ${summary.staleCount} holding${summary.staleCount === 1 ? " has" : "s have"} no live price and ${summary.staleCount === 1 ? "is" : "are"} valued at cost.`}
      </p>
    </div>
  )
}

function MoverList({
  movers,
  currency,
  tone,
}: {
  movers: Array<{ symbol: string; pnl: number; returnPct: number }>
  currency: string
  tone: "gain" | "loss"
}) {
  if (movers.length === 0) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No {tone === "gain" ? "positions in profit" : "positions at a loss"} right now.
      </p>
    )
  }

  const Icon = tone === "gain" ? TrendingUp : TrendingDown

  return (
    <ul className="divide-y">
      {movers.map((mover) => (
        <li key={mover.symbol} className="flex items-center gap-3 py-2.5">
          <Icon
            className={tone === "gain" ? "text-gain size-4" : "text-loss size-4"}
            aria-hidden
          />
          <Link
            href={`/stocks/${mover.symbol}`}
            className="tap flex-1 font-medium underline-offset-4 hover:underline"
          >
            {mover.symbol}
          </Link>
          {/* Sign and percentage, so meaning never rests on colour alone. */}
          <span className="text-right">
            <Delta value={mover.pnl} currency={currency} />
            <span className="block">
              <Percent value={mover.returnPct} className="text-xs" />
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
