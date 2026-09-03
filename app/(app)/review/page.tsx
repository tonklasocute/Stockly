import type { Metadata } from "next"
import Link from "next/link"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Metric, Section } from "@/components/metric"
import { StatCard, StatGrid } from "@/components/stat-card"
import { CurrencyExposure } from "@/components/currency-exposure"
import { BenchmarkPanel } from "@/features/intelligence/components/benchmark-panel"
import { InsightList } from "@/features/intelligence/components/insight-list"
import { RiskPanel } from "@/features/intelligence/components/risk-panel"
import { RangeTabs } from "@/features/intelligence/components/range-tabs"
import { BenchmarkPicker } from "@/features/intelligence/components/benchmark-picker"
import { GoalProgressBar } from "@/features/goals/components/goal-progress-bar"
import { ThesisBadge } from "@/features/theses/components/thesis-panel"
import { loadIntelligence } from "@/features/intelligence/loader"
import { toReviewRange } from "@/features/intelligence/range"
import { listBenchmarks } from "@/services/benchmark"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { formatCurrencyWithCode, formatOptionalPercent, formatPercent } from "@/lib/format"
import { NoPortfolio } from "../_no-portfolio"
import { appLocale } from "@/lib/i18n/server"

export const metadata: Metadata = { title: "Review" }

/**
 * The CSP is nonce-based, so every route that renders a script must be server-rendered — a
 * statically prerendered page has no nonce and its scripts are blocked in production only.
 */
export const dynamic = "force-dynamic"

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; range?: string }>
}) {
  const locale = await appLocale()
  const query = await searchParams
  const { active } = await resolveActivePortfolio(query.p)
  if (!active) return <NoPortfolio />

  const range = toReviewRange(query.range)
  const [bundle, benchmarks] = await Promise.all([
    loadIntelligence(active.id, range),
    listBenchmarks().catch(() => []),
  ])
  const { analytics, baseCurrency, risk, insights, goals, theses } = bundle

  const openTheses = theses.filter((thesis) => thesis.status !== "CLOSED")

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Portfolio review</h1>
          <p className="text-muted-foreground text-sm">{active.name}</p>
        </div>
        <RangeTabs current={range} portfolioId={active.id} />
      </div>

      {analytics.marketDataError && (
        <Alert>
          <AlertDescription>
            {analytics.marketDataError} Figures below are based on cost until prices return.
          </AlertDescription>
        </Alert>
      )}

      {/* 1. Performance, measured so that paying in is never mistaken for earning. */}
      <StatGrid>
        <StatCard
          label="Portfolio value"
          value={formatCurrencyWithCode(analytics.totalValue, baseCurrency)}
          emphasis
        />
        <StatCard
          label="Time-weighted return"
          value={
            bundle.timeWeightedReturnPct === null ? (
              <span className="text-muted-foreground text-lg">N/A</span>
            ) : (
              formatPercent(bundle.timeWeightedReturnPct)
            )
          }
          emphasis
          hint={
            <span className="text-muted-foreground">
              {bundle.valuations.length} valuation{bundle.valuations.length === 1 ? "" : "s"} in range
            </span>
          }
        />
        <StatCard
          label="Money-weighted return"
          value={
            bundle.moneyWeightedReturnPct === null ? (
              <span className="text-muted-foreground text-lg">N/A</span>
            ) : (
              formatPercent(bundle.moneyWeightedReturnPct)
            )
          }
          emphasis
          hint={<span className="text-muted-foreground">Annualised IRR, all history</span>}
        />
        <StatCard
          label="Current drawdown"
          value={
            risk.drawdown === null ? (
              <span className="text-muted-foreground text-lg">N/A</span>
            ) : (
              formatOptionalPercent(risk.drawdown.currentDrawdownPct, { signed: false })
            )
          }
          emphasis
          hint={
            <span className="text-muted-foreground">
              {risk.drawdown ? `Deepest ${formatOptionalPercent(risk.drawdown.maxDrawdownPct, { signed: false })}` : "Needs history"}
            </span>
          }
        />
      </StatGrid>

      <p className="text-muted-foreground text-xs">
        <strong className="font-medium">Time-weighted</strong> removes the effect of when you paid in
        or took money out, which is what makes it comparable to an index.{" "}
        <strong className="font-medium">Money-weighted</strong> keeps it, so it answers what you
        personally earned. Both are computed from the valuations Stockly recorded on the days you
        opened it, so a portfolio you visit rarely has a sparser series.
      </p>

      {/* 2. What is worth looking at. */}
      <Section
        title="Insights"
        description="Rules applied to your own figures. Deterministic, and never advice."
      >
        <InsightList insights={insights} />
      </Section>

      {/* 3. Benchmark. */}
      <Section
        title="Benchmark"
        description="Your time-weighted return against an index over the same period."
        action={<BenchmarkPicker portfolioId={active.id} benchmarks={benchmarks} selectedId={bundle.benchmark?.benchmark.id ?? null} />}
      >
        <BenchmarkPanel comparison={bundle.benchmark} />
      </Section>

      {/* 4. Risk. */}
      <Section
        title="Risk"
        description="Measured on flow-adjusted returns. A metric with too little data says so."
      >
        <RiskPanel risk={risk} />
      </Section>

      {/* 5. Concentration and exposure. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Concentration" description="How weight is spread across positions.">
          {risk.concentration ? (
            <dl className="grid grid-cols-2 gap-4">
              <Metric
                label="Largest position"
                value={formatPercent(risk.concentration.largestWeightPct, { signed: false })}
              />
              <Metric
                label="Top 3"
                value={formatPercent(risk.concentration.top3WeightPct, { signed: false })}
              />
              <Metric
                label="Top 5"
                value={formatPercent(risk.concentration.top5WeightPct, { signed: false })}
              />
              <Metric
                label="Positions"
                value={String(risk.concentration.positions)}
                hint={`Behaves like ${risk.concentration.effectivePositions}`}
              />
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">N/A — no priced positions.</p>
          )}
        </Section>

        <Section
          title="Sector exposure"
          description="From your market-data provider. Never inferred from a symbol."
        >
          {analytics.hasSectorData ? (
            <ul className="space-y-2">
              {analytics.sectors.slice(0, 6).map((slice) => (
                <li key={slice.key} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{slice.label}</span>
                  <span className="tabular text-muted-foreground">
                    {formatPercent(slice.weight, { signed: false })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-sm">
              N/A — your provider has no sector metadata for these holdings.
            </p>
          )}
        </Section>
      </div>

      {analytics.summary.exposures.length > 1 && (
        <CurrencyExposure summary={analytics.summary} />
      )}

      {/* 6. Goals and theses — the parts only the user can write. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Goals"
          description="Progress derived from the same figures as the dashboard."
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
          {goals.length === 0 ? (
            <p className="text-muted-foreground text-sm">No goals set.</p>
          ) : (
            <ul className="space-y-4">
              {goals.map(({ row, progress }) => (
                <li key={row.id}>
                  <GoalProgressBar progress={progress} baseCurrency={baseCurrency} locale={locale} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Theses"
          description="Your reasoning, with the status you set — never one Stockly decided."
          action={
            <Button
              nativeButton={false}
              render={<Link href={`/journal?p=${active.id}`} />}
              variant="outline"
              size="sm"
            >
              Journal
            </Button>
          }
        >
          {openTheses.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No open theses. Write one from a position page.
            </p>
          ) : (
            <ul className="divide-y">
              {openTheses.slice(0, 8).map((thesis) => (
                <li key={thesis.id} className="flex items-center gap-3 py-2 first:pt-0">
                  <Link
                    href={`/stocks/${thesis.symbol}?market=${thesis.market}&p=${active.id}`}
                    className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {thesis.symbol}
                  </Link>
                  <span className="text-muted-foreground shrink-0 text-xs">
                    Conviction {thesis.conviction}/10
                  </span>
                  <ThesisBadge status={thesis.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* 7. Fees, dividends and cash — the rest of the review checklist. */}
      <Section title="Costs and income" description={`All figures in ${baseCurrency}.`}>
        <dl className="grid gap-4 sm:grid-cols-4">
          <Metric
            label="Fees paid"
            value={formatCurrencyWithCode(analytics.fees.total, baseCurrency)}
            hint={
              analytics.fees.percentOfTurnover === null
                ? "N/A of turnover"
                : `${formatPercent(analytics.fees.percentOfTurnover, { signed: false })} of turnover`
            }
          />
          <Metric
            label="Dividends (12m)"
            value={formatCurrencyWithCode(
              analytics.dividends.summary.trailingTwelveMonths,
              baseCurrency,
            )}
            hint={
              analytics.dividends.summary.previousTwelveMonths === null
                ? "No prior year to compare"
                : `${formatCurrencyWithCode(analytics.dividends.summary.previousTwelveMonths, baseCurrency)} the year before`
            }
          />
          <Metric
            label="Cash balance"
            value={formatCurrencyWithCode(analytics.cash.balance, baseCurrency)}
            hint={`${formatCurrencyWithCode(analytics.cash.netContributed, baseCurrency)} net contributed`}
          />
          <Metric
            label="Win rate"
            value={
              analytics.tradeStats.winRate === null
                ? "N/A"
                : formatPercent(analytics.tradeStats.winRate, { signed: false })
            }
            hint={`${analytics.tradeStats.totalTrades} closed trade${analytics.tradeStats.totalTrades === 1 ? "" : "s"}`}
          />
        </dl>
      </Section>
    </div>
  )
}
