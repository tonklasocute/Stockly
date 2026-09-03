import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Delta, Percent } from "@/components/value"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { AllocationChart } from "@/features/dashboard/components/lazy-allocation-chart"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { listAlerts } from "@/features/alerts/queries"
import { describeAlert } from "@/domain/alerts"
import { alertSentence } from "@/features/alerts/alert-sentence"
import { toRuleFromRow } from "@/features/alerts/to-rule"
import { loadIntelligence } from "@/features/intelligence/loader"
import { loadDataQuality } from "@/features/data-quality/loader"
import { loadPreferences } from "@/features/personalization/queries"
import { loadHistory } from "@/features/history/loader"
import { loadPortfolioEvents } from "@/features/fundamentals/events-loader"
import { EventsWidget } from "@/features/fundamentals/components/events-widget"
import { NewsList } from "@/features/news/components/news-list"
import { loadNews } from "@/features/news/loader"
import { AttributionPanel } from "@/features/history/components/attribution-panel"
import { describeDrawdown } from "@/domain/drawdown-history"
import { resolveMetrics, visibleWidgets, withoutDismissed, type WidgetId } from "@/domain/personalization"
import { MetricTiles } from "@/features/personalization/components/metric-tiles"
import { QuickActions } from "@/features/personalization/components/quick-actions"
import { PinnedStrip, RecentStrip } from "@/features/personalization/components/pinned-strip"
import { InsightList } from "@/features/intelligence/components/insight-list"
import { GoalProgressBar } from "@/features/goals/components/goal-progress-bar"
import { Section } from "@/components/metric"
import { namesFrom } from "@/features/portfolios/portfolio-view"
import { CurrencyExposure, CurrencyNotice, TranslationNote } from "@/components/currency-exposure"
import { baseCurrencyOf } from "@/domain/market"
import { SCENARIO_RETURNS, planGoal, yearsUntil } from "@/domain/simulation"
import { DataLabel } from "@/features/simulations/components/assumptions"
import { formatCurrency, formatDate, formatPercent } from "@/lib/format"
import { NoPortfolio } from "../_no-portfolio"
import { appLocale } from "@/lib/i18n/server"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("dashboard") }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const tEnum = await getTranslations("enums")
  const ta = await getTranslations("alerts")
  const t = await getTranslations("dashboard")
  const locale = await appLocale()
  const { p } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  // One aggregation for the whole page: holdings, cash, dividends and fees come from a single pass
  // and a single batched quote call, so the dashboard cannot disagree with analytics.
  // `loadIntelligence` calls the same cached `loadAnalytics`, so goals, insights and risk cost no
  // extra pass over the transactions and no extra quote call.
  const [intelligence, alerts, dataQuality, preferences] = await Promise.all([
    loadIntelligence(active.id),
    listAlerts().catch(() => []),
    // Shares the same cached pass, so this costs one import count and one job-history read.
    loadDataQuality(active.id).catch(() => ({ issues: [], worst: null }) as const),
    /*
     * The layout, not the data.
     *
     * One extra row read, in parallel with everything else — **not** one request per widget. Which
     * widgets are on screen changes what is rendered from the single analytics pass above; it never
     * changes how many passes there are, and it can never change what any of them computed.
     */
    loadPreferences(),
  ])
  const bundle = intelligence.analytics
  const activeAlerts = alerts.filter((a) => a.enabled)
  const { holdings, summary, cash, totalValue, quotes, marketDataError, dividends, fees } = bundle
  const { missingFxPairs } = bundle
  const transactions = { length: bundle.transactionCount }
  const names = namesFrom(quotes)
  const currency = baseCurrencyOf(active.currency)
  const metrics = resolveMetrics(preferences.favoriteMetrics)
  /*
   * Loaded only when a phase 16 widget is actually on screen.
   *
   * It costs no upstream call — everything historical is rows already in the database — but it is
   * still a read, and a dashboard that shows neither widget should not pay for it.
   */
  const shown = visibleWidgets(preferences.dashboardLayout)
  const wantsHistory = shown.some((id) => id === "attribution" || id === "drawdowns")
  /*
   * Both loaded only when their widget is actually on screen.
   *
   * The events loader is the one on this page that can spend provider credits, so it must never
   * run for a dashboard that does not display it.
   */
  const [history, events, news] = await Promise.all([
    wantsHistory ? loadHistory(active.id, "1Y").catch(() => null) : Promise.resolve(null),
    shown.includes("events")
      ? loadPortfolioEvents(active.id).catch(() => null)
      : Promise.resolve(null),
    // Same rule: it can spend provider requests, so it never runs for a dashboard that hides it.
    shown.includes("news")
      ? loadNews(active.id, { scope: "PORTFOLIO", limit: 5 }).catch(() => null)
      : Promise.resolve(null),
  ])
  // Dismissal is a display filter applied to a list the rules already produced. The engine runs
  // identically for a user who has dismissed everything.
  const insights = withoutDismissed(intelligence.insights, preferences.dismissedInsights)
  /**
   * A single base-case line for the first dated goal, so the dashboard answers "am I on track"
   * without becoming a planning tool. Null whenever the arithmetic cannot be done honestly — no
   * goal, no target date, or a scenario the engine refuses.
   */
  const outlook = (() => {
    const goal = intelligence.goals.find(
      ({ progress }) => progress.targetDate !== null && progress.progressPct !== null,
    )
    if (!goal) return null
    const years = yearsUntil(goal.progress.targetDate, new Date())
    if (years === null) return null

    const plan = planGoal({
      currentValue: goal.progress.current,
      targetValue: goal.progress.target,
      contribution: 0,
      frequency: "MONTHLY",
      timing: "END",
      annualReturn: SCENARIO_RETURNS.BASE,
      years,
      contributionGrowth: 0,
      inflationRate: null,
      currency,
    })
    return plan.ok
      ? { projectedValue: plan.value.projectedValue, targetDate: goal.progress.targetDate! }
      : null
  })()

  const ranked = [...holdings].sort((a, b) => b.returnPct - a.returnPct)
  const best = ranked[0]
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined

  /**
   * The widget map.
   *
   * Keyed by the registry's ids so `visibleWidgets` can order them. Nothing in here fetches
   * anything: each entry is JSX over data already loaded, which is what makes an arbitrary
   * arrangement free and what stops one widget's failure from being a page's failure.
   */
  const widgets: Partial<Record<WidgetId, React.ReactNode>> = {
    summary: (
      <div className="space-y-4">
        <MetricTiles
          metrics={metrics}
          source={{
            currency,
            totalValue,
            investedValue: summary.investedValue,
            marketValue: summary.marketValue,
            cashBalance: cash.balance,
            unrealizedPnl: summary.unrealizedPnl,
            realizedPnl: summary.realizedPnl,
            returnPct: summary.returnPct,
            todayPnl: summary.todayPnl,
            todayReturnPct: summary.todayReturnPct,
            holdingsCount: summary.holdingsCount,
            dividendIncome: dividends.summary.trailingTwelveMonths,
            yieldOnCost: dividends.yieldOnCost,
            yieldOnValue: dividends.yieldOnValue,
            // Null for an empty portfolio: no positions is not a largest position of 0%.
            largestWeightPct: bundle.concentration.largest?.weight ?? null,
          }}
        />
              {/* The figures that are not P&L, kept out of the headline row so it stays readable. */}
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-4">
                {[
                  { label: t("review.investedCapital"), value: formatCurrency(summary.investedValue, currency) },
                  { label: t("review.netContributed"), value: formatCurrency(cash.netContributed, currency) },
                  { label: t("review.dividendsReceived"), value: formatCurrency(dividends.summary.totalNet, currency) },
                  { label: t("review.totalFees"), value: formatCurrency(fees.total, currency) },
                ].map((item) => (
                  <div key={item.label} className="bg-card space-y-0.5 p-4">
                    <dt className="text-muted-foreground text-xs">{item.label}</dt>
                    <dd className="tabular font-semibold">{item.value}</dd>
                  </div>
                ))}
              </dl>
              <CurrencyExposure summary={summary} />
              <TranslationNote summary={summary} />
      </div>
    ),

    quickActions: <QuickActions portfolioId={active.id} />,

    dataQuality: dataQuality.worst !== null ? (
      <>
                {dataQuality.worst !== null && (
                  <Alert>
                    <AlertDescription className="flex flex-wrap items-center gap-x-2">
                      <span>
                        {dataQuality.issues.length} data issue
                        {dataQuality.issues.length === 1 ? "" : "s"} — {dataQuality.issues[0].title}.
                      </span>
                      <Link
                        href={`/data-quality?p=${active.id}`}
                        className="underline underline-offset-4"
                      >{t("actions.review")}</Link>
                    </AlertDescription>
                  </Alert>
                )}
      </>
    ) : null,

    goals: intelligence.goals.length > 0 || insights.length > 0 ? (
      <>
                {(intelligence.goals.length > 0 || intelligence.insights.length > 0) && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    {intelligence.goals.length > 0 && (
                      <Section
                        title={t("sections.goals")}
                        description={t("sections.goalsHint")}
                        action={
                          <Button
                            nativeButton={false}
                            render={<Link href={`/goals?p=${active.id}`} />}
                            variant="outline"
                            size="sm"
                          >{t("actions.manage")}</Button>
                        }
                      >
                        <ul className="space-y-4">
                          {intelligence.goals.slice(0, 2).map(({ row, progress }) => (
                            <li key={row.id}>
                              <GoalProgressBar progress={progress} baseCurrency={currency} locale={locale} />
                            </li>
                          ))}
                        </ul>

                        {/*
                          One projected line beside the actual progress, labelled so the two cannot be
                          confused. Everything else about planning lives on its own page — a dashboard
                          full of scenarios would make assumptions look like facts.
                        */}
                        {outlook && (
                          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs">
                            <DataLabel kind="PROJECTED" />
                            <span className="text-muted-foreground">
                              At {formatPercent(SCENARIO_RETURNS.BASE * 100, { signed: false })} a year:{" "}
                              <span className="tabular text-foreground font-medium">
                                {formatCurrency(outlook.projectedValue, currency)}
                              </span>{" "}
                              by {formatDate(outlook.targetDate, locale)}
                            </span>
                            <Link
                              href={`/simulations?p=${active.id}`}
                              className="text-muted-foreground ml-auto underline-offset-4 hover:underline"
                            >{t("actions.plan")}</Link>
                          </div>
                        )}
                      </Section>
                    )}

                    <Section
                      title={t("sections.insights")}
                      description={t("sections.insightsHint")}
                      action={
                        <Button
                          nativeButton={false}
                          render={<Link href={`/review?p=${active.id}`} />}
                          variant="outline"
                          size="sm"
                        >{t("actions.fullReview")}</Button>
                      }
                      className={intelligence.goals.length === 0 ? "lg:col-span-2" : undefined}
                    >
                      <InsightList insights={insights} limit={3} />
                    </Section>
                  </div>
                )}
      </>
    ) : null,

    allocation: (
      <>
                <div className="grid gap-4 lg:grid-cols-2">
                  <section className="bg-card rounded-xl border p-4 sm:p-5">
                    <h2 className="mb-4 text-sm font-semibold">{t("sections.allocation")}</h2>
                    {holdings.length ? (
                      <AllocationChart holdings={holdings} currency={currency} />
                    ) : (
                      <p className="text-muted-foreground py-8 text-center text-sm">{t("sections.allocationEmpty")}</p>
                    )}
                  </section>

                  <section className="bg-card rounded-xl border p-4 sm:p-5">
                    <h2 className="mb-4 text-sm font-semibold">{t("sections.performance")}</h2>
                    {best ? (
                      <div className="grid gap-3">
                        {[
                          { label: t("review.bestPerformer"), holding: best, icon: TrendingUp },
                          ...(worst ? [{ label: t("review.worstPerformer"), holding: worst, icon: TrendingDown }] : []),
                        ].map(({ label, holding, icon: Icon }) => (
                          <div
                            key={label}
                            className="bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2.5"
                          >
                            <Icon
                              className={label === t("review.bestPerformer") ? "text-gain size-4" : "text-loss size-4"}
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
                      <p className="text-muted-foreground py-8 text-center text-sm">{t("sections.performanceEmpty")}</p>
                    )}
                  </section>
                </div>
      </>
    ),

    alerts: activeAlerts.length > 0 ? (
      <>
                {activeAlerts.length > 0 && (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold">
                        {activeAlerts.length} active alert{activeAlerts.length === 1 ? "" : "s"}
                      </h2>
                      <Link
                        href="/alerts"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm underline-offset-4 hover:underline pointer-coarse:-my-2 pointer-coarse:min-h-11 pointer-coarse:py-2"
                      >{t("actions.manage")}</Link>
                    </div>
                    <ul className="divide-y overflow-hidden rounded-xl border">
                      {activeAlerts.slice(0, 4).map((alert) => (
                        <li key={alert.id} className="bg-card px-4 py-2.5 text-sm">
                          {alertSentence(
                    describeAlert(toRuleFromRow(alert)),
                    ta,
                    tEnum(`alertType.${alert.type}`),
                  )}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
      </>
    ) : null,

    transactions: (
      <>
                <section className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold">{t("sections.topHoldings")}</h2>
                    <Link
                      href={`/portfolio?p=${active.id}`}
                      className="text-muted-foreground hover:text-foreground inline-flex items-center text-sm underline-offset-4 hover:underline pointer-coarse:-my-2 pointer-coarse:min-h-11 pointer-coarse:py-2"
                    >{t("actions.viewAll")}</Link>
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
    ),

    /*
     * Phase 16's two widgets, both loaded lazily-by-visibility: `loadHistory` is only awaited when
     * one of them is switched on, so a dashboard that does not show them costs nothing extra. Both
     * read the same snapshot series and transaction set the rest of the page already has.
     */
    attribution: history ? (
      <AttributionPanel
        attribution={history.attribution}
        residual={history.attributionResidual}
        contributors={history.contributors.contributors}
        detractors={history.contributors.detractors}
        currency={currency}
      />
    ) : null,

    events: events ? <EventsWidget data={events} /> : null,

    news: news ? (
      <NewsList data={news} title={t("sections.news")} description={t("sections.newsHint")} />
    ) : null,

    drawdowns: history?.drawdowns ? (
      <Section title={t("sections.drawdowns")} description={history.regime ? tEnum(`regime.${history.regime}`) : undefined}>
        <p className="text-sm">
          {history.drawdowns.worst
            ? describeDrawdown(history.drawdowns.worst)
            : "No fall large enough to report."}
        </p>
        <p className="text-muted-foreground mt-2 text-xs">
          Currently {history.drawdowns.currentDepthPct.toFixed(1)}% below its high, measured on the
          flow-adjusted return index so a deposit cannot look like a recovery.
        </p>
      </Section>
    ) : null,

    pinned: (
      <Section title={t("sections.pinned")}>
        <PinnedStrip items={preferences.pinnedItems} />
      </Section>
    ),
    recent: (
      <Section title={t("sections.recent")}>
        <RecentStrip items={preferences.recentItems} />
      </Section>
    ),
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{t("title")}</h1>
          <p className="text-muted-foreground text-sm">{active.name}</p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href={`/transactions?p=${active.id}`} />}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >{t("sections.transactions")}<ArrowRight className="size-3.5" aria-hidden />
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
            title={t("empty.title")}
            description={t("empty.body")}
            action={
              <Button
                nativeButton={false}
                render={<Link href={`/transactions?p=${active.id}`} />}
                className="gap-2 max-sm:h-11"
              >{t("empty.action")}</Button>
            }
          />
        </div>
      ) : (
        /*
         * The dashboard, arranged by the user.
         *
         * Every widget below renders from the **same single analytics pass** loaded above — the
         * layout decides what appears and in what order, never how many times the engine runs.
         * That is why ten widgets do not cost ten requests, and why hiding one saves rendering
         * rather than saving a query.
         *
         * A widget whose data is absent contributes `null` and is skipped: an alerts card with no
         * alerts is noise, not information.
         */
        <>
          {visibleWidgets(preferences.dashboardLayout).map((id) =>
            widgets[id] ? <div key={id}>{widgets[id]}</div> : null,
          )}
        </>
      )}
    </div>
  )
}
