import Link from "next/link"
import { Metric, Section } from "@/components/metric"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Percent } from "@/components/value"
import { Badge } from "@/components/ui/badge"
import type { PublicPortfolio } from "@/domain/sharing"
import {
  formatCurrency,
  formatOptionalPercent,
  formatPercent,
  formatQuantity,
  formatTime,
} from "@/lib/format"
import type { Locale } from "@/domain/locale"
import { getTranslations } from "next-intl/server"

/**
 * The shared page.
 *
 * **One component renders every shared surface** — a public address, a share link, a snapshot and
 * the owner's own preview. That is not tidiness: a preview drawn by different code than the real
 * page is a preview that can be wrong about what a stranger sees, and being wrong about that is the
 * one bug this feature must not have.
 *
 * It reads only a `PublicPortfolio`, so it cannot render a private field: there is none in the type
 * and none in the document. A section the owner withheld is not a hidden `<div>` — it is absent
 * from the data, and the markup for it is never produced.
 */
export async function PublicPortfolioView({
  portfolio,
  asOf,
  frozen,
  locale,
}: {
  portfolio: PublicPortfolio
  /** When the document was published, or when the snapshot was taken. */
  asOf: string
  /** A snapshot: a fixed point in time rather than the current publication. */
  frozen?: { label: string | null; takenAt: string }
  /*
   * The *visitor's* language, passed in rather than resolved here.
   *
   * A shared page is read by somebody who has no preference row and may have no session at all, so
   * its language comes from `?lang=` on the URL with the default underneath. Resolving it inside
   * this component would quietly make a stranger's page depend on the owner's cookie.
   */
  locale: Locale
}) {
  /*
   * The **visitor's** language, not the ambient request's.
   *
   * `locale` arrives as a prop from `?lang=`, and passing it explicitly here is what stops a
   * shared page rendering in the owner's language for a stranger. `lib/i18n/request.ts` honours
   * the explicit locale over the cookie for exactly this call.
   */
  const t = await getTranslations({ locale, namespace: "sharing" })

  const { sections, baseCurrency } = portfolio
  const money = (value: number) => formatCurrency(value, baseCurrency)

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-5 sm:py-8">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">
            {portfolio.displayName}
          </h1>
          {/*
            Snapshot and publication are labelled differently and always. A frozen page that looked
            like a current one would be the single most misleading thing this feature could do.
          */}
          {frozen ? (
            <Badge variant="secondary">
              {t("public.snapshotBadge")} · {formatTime(frozen.takenAt, locale)}
            </Badge>
          ) : (
            <Badge variant="outline">
              {t("public.publishedAt")} {formatTime(asOf, locale)}
            </Badge>
          )}
        </div>
        {portfolio.description ? (
          <p className="text-muted-foreground text-sm">{portfolio.description}</p>
        ) : null}
        <p className="text-muted-foreground text-xs">
          {portfolio.ownerDisplayName ? `Shared by ${portfolio.ownerDisplayName} · ` : ""}
          Base currency {baseCurrency}
          {frozen?.label ? ` · ${frozen.label}` : ""}
        </p>
      </header>

      <FreshnessNote portfolio={portfolio} locale={locale} />

      {sections.overview ? (
        <StatGrid>
          <StatCard
            label={t("public.totalReturn")}
            value={<Percent value={sections.overview.returnPct} />}
            emphasis
            hint={
              sections.overview.todayReturnPct !== null ? (
                <span className="text-muted-foreground">
                  Today {formatPercent(sections.overview.todayReturnPct)}
                </span>
              ) : (
                // Never 0. No previous close means today's change is unknown, not flat.
                <span className="text-muted-foreground">{t("public.todayUnavailable")}</span>
              )
            }
          />
          {sections.overview.totalValue !== undefined ? (
            <StatCard label={t("public.portfolioValue")} value={money(sections.overview.totalValue)} />
          ) : null}
          {sections.overview.investedValue !== undefined ? (
            <StatCard label={t("public.invested")} value={money(sections.overview.investedValue)} />
          ) : null}
          <StatCard label={t("public.positions")} value={String(sections.overview.holdingsCount)} />
          {sections.overview.unrealizedPnl !== undefined ? (
            <StatCard label={t("public.unrealizedPnl")} value={money(sections.overview.unrealizedPnl)} />
          ) : null}
          {sections.overview.realizedPnl !== undefined ? (
            <StatCard label={t("public.realizedPnl")} value={money(sections.overview.realizedPnl)} />
          ) : null}
          {sections.overview.cashValue !== undefined ? (
            <StatCard label={t("public.cash")} value={money(sections.overview.cashValue)} />
          ) : null}
        </StatGrid>
      ) : null}

      {sections.performance ? (
        <Section title={t("public.performance")} description={`Time-weighted, ${sections.performance.range}`}>
          <dl className="grid grid-cols-2 gap-4">
            <Metric
              label={t("public.twr")}
              value={formatOptionalPercent(sections.performance.timeWeightedReturnPct)}
              hint="Deposits and withdrawals removed"
            />
            <Metric
              label={t("public.mwr")}
              value={formatOptionalPercent(sections.performance.moneyWeightedReturnPct)}
              hint="What this investor earned"
            />
          </dl>
          {sections.performance.series.length > 1 ? (
            <p className="text-muted-foreground mt-3 text-xs">
              {sections.performance.series.length} observations, indexed to 100 at the start of the
              period. The index carries the shape of the performance and not the size of the
              portfolio.
            </p>
          ) : null}
        </Section>
      ) : null}

      {sections.benchmark ? (
        <Section title={t("public.benchmark")} description={sections.benchmark.name}>
          {sections.benchmark.unavailableReason ? (
            <p className="text-muted-foreground text-sm">{sections.benchmark.unavailableReason}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Metric
                label={t("public.portfolio")}
                value={formatOptionalPercent(sections.benchmark.portfolioReturnPct)}
              />
              <Metric
                label={sections.benchmark.name}
                value={formatOptionalPercent(sections.benchmark.benchmarkReturnPct)}
              />
              <Metric
                label={t("public.difference")}
                value={formatOptionalPercent(sections.benchmark.differencePct)}
                hint={
                  sections.benchmark.differencePct === null
                    ? "Different currencies — not comparable"
                    : undefined
                }
              />
            </dl>
          )}
        </Section>
      ) : null}

      {sections.holdings ? (
        <Section
          title={t("public.holdings")}
          description={
            sections.holdings.hiddenCount > 0
              ? `${sections.holdings.positions.length} of ${
                  sections.holdings.positions.length + sections.holdings.hiddenCount
                } positions`
              : undefined
          }
        >
          <ul className="divide-y">
            {sections.holdings.positions.map((position) => (
              <li
                key={`${position.market}:${position.symbol}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 first:pt-0 last:pb-0"
              >
                <div className="min-w-0">
                  <span className="font-medium">{position.symbol}</span>
                  <span className="text-muted-foreground ml-2 text-xs">{position.market}</span>
                  {position.stale ? (
                    <span className="text-muted-foreground ml-2 text-xs">· price unavailable</span>
                  ) : null}
                </div>
                <div className="tabular text-muted-foreground flex items-baseline gap-4 text-sm">
                  {position.quantity !== undefined ? (
                    <span>{formatQuantity(position.quantity)}</span>
                  ) : null}
                  {position.marketValue !== undefined ? (
                    <span>
                      {position.marketValue === null ? "N/A" : money(position.marketValue)}
                    </span>
                  ) : null}
                  {position.returnPct !== undefined ? (
                    <Percent value={position.returnPct} />
                  ) : null}
                  {/* Null weight is a holding no exchange rate reached — genuinely unknown, not 0%. */}
                  <span className="text-foreground w-14 text-right font-medium">
                    {position.weightPct === null ? "N/A" : `${position.weightPct.toFixed(1)}%`}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {sections.allocation ? (
        <Section title={t("public.allocation")}>
          <div className="grid gap-5 sm:grid-cols-3">
            <AllocationList title={t("public.positions")} entries={sections.allocation.positions} />
            <AllocationList title={t("public.markets")} entries={sections.allocation.markets} />
            <AllocationList title={t("public.currencies")} entries={sections.allocation.currencies} />
          </div>
        </Section>
      ) : null}

      {sections.risk ? (
        <Section
          title={t("public.risk")}
          description={`Measured over ${sections.risk.observations} observations`}
        >
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label={t("public.volatility")} value={formatOptionalPercent(sections.risk.volatilityPct)} />
            <Metric
              label={t("public.maxDrawdown")}
              value={formatOptionalPercent(sections.risk.maxDrawdownPct)}
            />
            <Metric
              label={t("public.sharpe")}
              value={sections.risk.sharpe === null ? "N/A" : sections.risk.sharpe.toFixed(2)}
            />
            <Metric
              label={t("public.beta")}
              value={sections.risk.beta === null ? "N/A" : sections.risk.beta.toFixed(2)}
            />
            <Metric
              label={t("public.largestPosition")}
              value={formatOptionalPercent(sections.risk.topWeightPct)}
            />
          </dl>
          {sections.risk.limitations.length > 0 ? (
            <ul className="text-muted-foreground mt-3 space-y-1 text-xs">
              {sections.risk.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      {sections.income ? (
        <Section title={t("public.dividends")}>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric
              label={t("public.yieldOnValue")}
              value={formatOptionalPercent(sections.income.yieldOnValuePct)}
            />
            <Metric
              label={t("public.yieldOnCost")}
              value={formatOptionalPercent(sections.income.yieldOnCostPct)}
            />
            {sections.income.trailingTwelveMonths !== undefined ? (
              <Metric
                label={t("public.last12Months")}
                value={
                  sections.income.trailingTwelveMonths === null
                    ? "N/A"
                    : money(sections.income.trailingTwelveMonths)
                }
              />
            ) : null}
          </dl>
        </Section>
      ) : null}

      {sections.goals && sections.goals.length > 0 ? (
        <Section title={t("public.goals")}>
          <ul className="space-y-3">
            {sections.goals.map((goal, index) => (
              <li key={`${goal.label}-${index}`} className="space-y-1">
                <div className="flex items-baseline justify-between gap-4 text-sm">
                  <span>{goal.label}</span>
                  <span className="tabular text-muted-foreground">
                    {goal.progressPct === null ? "N/A" : `${goal.progressPct.toFixed(0)}%`}
                    {goal.targetLabel ? ` of ${goal.targetLabel}` : ""}
                  </span>
                </div>
                <div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-foreground h-full rounded-full"
                    style={{ width: `${Math.min(100, Math.max(0, goal.progressPct ?? 0))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {sections.insights && sections.insights.length > 0 ? (
        <Section
          title={t("public.insights")}
          description={t("public.insightsHint")}
        >
          <ul className="space-y-3">
            {sections.insights.map((insight) => (
              <li key={insight.code} className="space-y-0.5">
                <p className="text-sm font-medium">{insight.title}</p>
                <p className="text-muted-foreground text-sm">{insight.detail}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {Object.keys(sections).length === 0 ? (
        <Section title={t("public.nothingShared")}>
          <p className="text-muted-foreground text-sm">{t("public.nothingSharedBody")}</p>
        </Section>
      ) : null}

      <footer className="text-muted-foreground space-y-2 border-t pt-5 text-xs">
        <p>{t("public.footer.disclaimer")}</p>
        <p>
          {t("public.footer.calculated", { at: formatTime(portfolio.calculatedAt, locale) })}{" "}
          {frozen ? t("public.footer.snapshotNote") : t("public.footer.liveNote")}
        </p>
        <p>
          <Link href="/" className="underline-offset-4 hover:underline">
            Stockly
          </Link>
        </p>
      </footer>
    </div>
  )
}

/**
 * What the page admits it does not know.
 *
 * Carried into the published document rather than recomputed here, so a snapshot taken during a
 * provider outage still says so months later.
 */
async function FreshnessNote({
  portfolio,
  locale,
}: {
  portfolio: PublicPortfolio
  locale: Locale
}) {
  const t = await getTranslations({ locale, namespace: "sharing" })
  const { freshness } = portfolio
  const notes: string[] = []
  if (freshness.marketDataStale) notes.push(t("public.freshness.pricesStale"))
  if (freshness.untranslatedCount > 0) {
    // ICU handles both the count and the verb that agrees with it; Thai needs neither and says so.
    notes.push(
      t("public.freshness.untranslated", {
        count: freshness.untranslatedCount,
        currency: portfolio.baseCurrency,
      }),
    )
  }
  if (notes.length === 0) return null

  return (
    <div className="text-muted-foreground bg-muted/40 space-y-1 rounded-lg border px-3 py-2 text-xs">
      {notes.map((note) => (
        <p key={note}>{note}</p>
      ))}
    </div>
  )
}

function AllocationList({
  title,
  entries,
}: {
  title: string
  entries: { key: string; label: string; weightPct: number }[]
}) {
  if (entries.length === 0) return null
  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</p>
      <ul className="space-y-1 text-sm">
        {entries.slice(0, 8).map((entry) => (
          <li key={entry.key} className="flex items-baseline justify-between gap-3">
            <span className="truncate">{entry.label}</span>
            <span className="tabular text-muted-foreground">{entry.weightPct.toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
