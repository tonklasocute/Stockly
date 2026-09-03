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
import { CurrencyExposure, CurrencyNotice, TranslationNote } from "@/components/currency-exposure"
import { baseCurrencyOf } from "@/domain/market"
import { formatCurrency, formatCurrencyWithCode, formatOptional, formatPercent } from "@/lib/format"
import { getUser } from "@/lib/supabase/server"
import { NoPortfolio } from "../_no-portfolio"
import { describeError, logger } from "@/lib/log"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("analytics") }
}

type Props = { searchParams: Promise<{ p?: string; range?: string }> }

const CONCENTRATION_TEXT: Record<string, string> = {
  concentrated: "This portfolio is concentrated in a few positions.",
  moderate: "This portfolio has a moderately large single position.",
  diversified: "This portfolio is spread across its positions.",
}

export default async function AnalyticsPage({ searchParams }: Props) {
  const tNav = await getTranslations("navigation")
  const t = await getTranslations("analytics")
  const { p, range: rangeParam } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const range: TimeRange = toTimeRange(rangeParam)
  const bundle = await loadAnalytics(active.id)
  const currency = baseCurrencyOf(active.currency)

  // Write-on-read: the quotes were fetched to render this page, so capturing today's value costs
  // nothing extra. See recordSnapshot for why this beats a cron on a free-tier provider.
  //
  // Best-effort by design: losing one day of history is a far smaller failure than refusing to
  // render analytics because a snapshot write hiccuped.
  try {
    const user = await getUser()
    if (user) await recordSnapshot(active.id, user.id, bundle)
  } catch (error) {
    logger.warn("analytics.snapshot_skipped", describeError(error))
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
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("analytics")}</h1>
        <div className="rounded-xl border">
          <EmptyState
            icon={BarChart3}
            title={t("empty.title")}
            description={t("empty.body")}
            action={
              <Button
                nativeButton={false}
                render={<Link href={`/transactions?p=${active.id}`} />}
                className="max-sm:h-11"
              >{t("empty.action")}</Button>
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
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("analytics")}</h1>
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

      <CurrencyNotice summary={summary} missingFxPairs={bundle.missingFxPairs} />

      {/* 1. The headline numbers. */}
      <StatGrid>
        <StatCard
          label={t("summary.portfolioValue")}
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
          label={t("summary.totalPnl")}
          value={<Delta value={totalPnl} currency={currency} />}
          emphasis
          hint={<Percent value={summary.returnPct} />}
        />
        <StatCard
          label={t("summary.unrealized")}
          value={<Delta value={summary.unrealizedPnl} currency={currency} />}
          emphasis
          hint={
            <span className="text-muted-foreground">
              on {formatCurrency(summary.investedValue, currency)} invested
            </span>
          }
        />
        <StatCard
          label={t("summary.realized")}
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
        title={t("performance.title")}
        description={t("performance.hint")}
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
        <Section title={t("allocation.title")} description={t("allocation.hint")}>
          <AllocationDonut slices={allocation} currency={currency} />
        </Section>

        <Section
          title={t("concentration.title")}
          description={t("concentration.hint")}
        >
          <dl className="grid grid-cols-2 gap-3">
            <Metric
              label={t("concentration.largestPosition")}
              value={
                concentration.largest
                  ? `${concentration.largest.symbol} · ${formatPercent(concentration.largest.weight, { signed: false })}`
                  : "N/A"
              }
            />
            <Metric label={t("concentration.positions")} value={String(concentration.positionCount)} />
            <Metric
              label={t("concentration.top3")}
              value={formatPercent(concentration.top3Weight, { signed: false })}
            />
            <Metric
              label={t("concentration.top5")}
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
            <Section title={t("allocation.bySector")} description={t("allocation.sectorHint")}>
              <AllocationTable slices={sectors} currency={currency} label={t("allocation.sector")} />
            </Section>
          )}
          {hasIndustryData && (
            <Section title={t("allocation.byIndustry")}>
              <AllocationTable slices={industries} currency={currency} label={t("allocation.industry")} />
            </Section>
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("allocation.byCountry")} description={t("allocation.countryHint")}>
          <AllocationTable slices={countries} currency={currency} label={t("allocation.country")} />
        </Section>
        <Section
          title={t("allocation.currencyExposure")}
          description={`Held value by currency, translated into ${currency} at today's rate.`}
        >
          {summary.exposures.length > 1 ? (
            <CurrencyExposure summary={summary} />
          ) : (
            <AllocationTable slices={currencies} currency={currency} label={t("allocation.currency")} />
          )}
        </Section>
      </div>

      {/* 4. Winners and losers. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("movers.topGainers")} description={t("movers.sincePurchase")}>
          <MoverList movers={movers.gainers} tone="gain" />
        </Section>
        <Section title={t("movers.topLosers")} description={t("movers.sincePurchase")}>
          <MoverList movers={movers.losers} tone="loss" />
        </Section>
      </div>

      {today && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title={t("movers.todayGainers")}>
            <MoverList movers={today.gainers} tone="gain" />
          </Section>
          <Section title={t("movers.todayLosers")}>
            <MoverList movers={today.losers} tone="loss" />
          </Section>
        </div>
      )}

      {/* 5. Attribution. */}
      <Section
        title={t("contribution.title")}
        description={t("contribution.hint")}
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
          title={t("contribution.realizedPnl")}
          description={t("trades.hint")}
        >
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Metric
              label={t("trades.winRate")}
              value={formatOptional(tradeStats.winRate, (v) => formatPercent(v, { signed: false }))}
              hint={`${tradeStats.winningTrades} of ${tradeStats.winningTrades + tradeStats.losingTrades} decided`}
            />
            <Metric label={t("trades.winning")} value={String(tradeStats.winningTrades)} />
            <Metric label={t("trades.losing")} value={String(tradeStats.losingTrades)} />
            <Metric
              label={t("trades.averageWin")}
              value={formatOptional(tradeStats.averageWin, (v) => formatCurrency(v, currency))}
            />
            <Metric
              label={t("trades.averageLoss")}
              value={formatOptional(tradeStats.averageLoss, (v) => formatCurrency(v, currency))}
            />
            <Metric
              label={t("trades.totalRealized")}
              value={formatCurrency(tradeStats.totalRealized, currency)}
            />
            <Metric
              label={t("trades.bestTrade")}
              value={
                tradeStats.best
                  ? `${tradeStats.best.symbol} ${formatCurrency(tradeStats.best.realizedPnl, currency)}`
                  : "N/A"
              }
            />
            <Metric
              label={t("trades.worstTrade")}
              value={
                tradeStats.worst
                  ? `${tradeStats.worst.symbol} ${formatCurrency(tradeStats.worst.realizedPnl, currency)}`
                  : "N/A"
              }
            />
            <Metric
              label={t("trades.averageHold")}
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

        <Section title={t("fees.title")} description={t("fees.hint")}>
          <dl className="grid grid-cols-2 gap-3">
            <Metric label={t("fees.total")} value={formatCurrency(fees.total, currency)} />
            <Metric
              label={t("fees.ofTurnover")}
              value={formatOptional(fees.percentOfTurnover, (v) =>
                formatPercent(v, { signed: false }),
              )}
            />
            <Metric label={t("fees.thisMonth")} value={formatCurrency(fees.thisMonth, currency)} />
            <Metric label={t("fees.thisYear")} value={formatCurrency(fees.thisYear, currency)} />
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
        title={t("dividends.title")}
        description={t("dividends.hint")}
        action={
          <Button
            nativeButton={false}
            render={<Link href={`/dividends?p=${active.id}`} />}
            variant="outline"
            size="sm"
          >{t("dividends.all")}</Button>
        }
      >
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Metric
            label={t("dividends.receivedAllTime")}
            value={formatCurrency(dividends.summary.totalNet, currency)}
          />
          <Metric
            label={t("dividends.last12Months")}
            value={formatCurrency(dividends.summary.trailingTwelveMonths, currency)}
          />
          <Metric
            label={t("dividends.yieldOnValue")}
            value={formatOptional(dividends.yieldOnValue, (v) => formatPercent(v, { signed: false }))}
            hint="12m dividends ÷ market value"
          />
          <Metric
            label={t("dividends.yieldOnCost")}
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

      <TranslationNote summary={summary} />
    </div>
  )
}

function MoverList({
  movers,
  tone,
}: {
  /**
   * Each mover carries the currency its P&L is in — the instrument's own, not the portfolio's.
   * Ranking is by percentage return, which is currency-neutral, so nothing here needs a rate and
   * the amount beside each row is the real amount in the currency it was made in.
   */
  movers: Array<{ symbol: string; market: string; currency: string; pnl: number; returnPct: number }>
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
            <Delta value={mover.pnl} currency={mover.currency} />
            <span className="block">
              <Percent value={mover.returnPct} className="text-xs" />
            </span>
          </span>
        </li>
      ))}
    </ul>
  )
}
