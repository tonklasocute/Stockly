import type { Metadata } from "next"
import { Scale } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Metric, Section } from "@/components/metric"
import { loadAnalytics } from "@/features/analytics/portfolio-analytics"
import { AdjustmentsPanel } from "@/features/operations/components/adjustments-panel"
import { Findings } from "@/features/operations/components/findings"
import { ReconcileForm } from "@/features/operations/components/reconcile-form"
import { TransferPanel } from "@/features/operations/components/transfer-panel"
import { allItems, listRuns, listShareAdjustments } from "@/features/operations/queries"
import { summariseItems } from "@/features/operations/reconcile"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { formatCurrency, formatTime } from "@/lib/format"
import { NoPortfolio } from "../_no-portfolio"
import { appLocale } from "@/lib/i18n/server"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("reconciliation") }
}

/**
 * The CSP is nonce-based, so every route that renders a script must be server-rendered — a
 * statically prerendered page has no nonce and its scripts are blocked in production only.
 */
export const dynamic = "force-dynamic"

const RUN_STATUS_LABELS: Record<string, string> = {
  PENDING: "Not started",
  PROCESSING: "Still running",
  COMPLETED: "Everything matched",
  COMPLETED_WITH_WARNINGS: "Differences found",
  FAILED: "Could not be completed",
}

/**
 * Reconciliation.
 *
 * The page states its own boundary at the top and never contradicts it lower down: a comparison
 * describes, and a change happens when the user makes one. Every action offered here either records
 * a decision (marking a finding reviewed) or records a fact the user confirmed (a split) — none of
 * them writes a transaction, and nothing on this page can.
 */
export default async function OperationsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; run?: string }>
}) {
  const tNav = await getTranslations("navigation")
  const to = await getTranslations("operations")
  const locale = await appLocale()
  const query = await searchParams
  const { active, portfolios } = await resolveActivePortfolio(query.p)
  if (!active) return <NoPortfolio />

  const [runs, adjustments, analytics] = await Promise.all([
    listRuns(active.id),
    listShareAdjustments(active.id),
    loadAnalytics(active.id),
  ])

  // The run being looked at: the one asked for, else the most recent.
  const selected = runs.find((run) => run.id === query.run) ?? runs[0] ?? null
  const items = selected ? await allItems(selected.id) : []
  const summary = summariseItems(items)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("reconciliation")}</h1>
        <p className="text-muted-foreground text-sm">
          {active.name} · compare a broker statement against these records. A difference is
          described, never applied — nothing here changes a transaction, a holding or a balance.
        </p>
      </div>

      <Section
        title={to("cashByCurrency")}
        description={to("cashByCurrencyHint")}
      >
        {analytics.cashByCurrency.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">{to("noCashYet")}</p>
        ) : (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {analytics.cashByCurrency.map((balance) => (
              <Metric
                key={balance.currency}
                label={balance.currency}
                value={formatCurrency(balance.balance, balance.currency)}
                hint={`${formatCurrency(balance.netContributed, balance.currency)} contributed`}
              />
            ))}
          </dl>
        )}
      </Section>

      <Section
        title={to("compare")}
        description={to("compareHint")}
      >
        <ReconcileForm portfolioId={active.id} />
      </Section>

      {selected ? (
        <>
          <Section
            title={selected.source_label}
            description={`${RUN_STATUS_LABELS[selected.status] ?? selected.status} · ${
              selected.completed_at ? formatTime(selected.completed_at, locale) : "in progress"
            }`}
          >
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label={to("positionsCompared")} value={summary.positions.total} />
              <Metric
                label={to("positionDifferences")}
                value={summary.positions.differences}
                hint={`${summary.positions.unresolved} to review`}
              />
              <Metric label={to("balancesCompared")} value={summary.cash.total} />
              <Metric
                label={to("balanceDifferences")}
                value={summary.cash.differences}
                hint={`${summary.cash.unresolved} to review`}
              />
            </dl>
            {selected.status === "FAILED" ? (
              <p className="mt-4 rounded-lg border border-dashed p-3 text-sm">
                This comparison could not be completed, so it found nothing — which is different
                from finding nothing wrong. Run it again.
              </p>
            ) : null}
          </Section>

          <Section
            title={to("positions")}
            description={to("positionsHint")}
          >
            <Findings items={items.filter((item) => item.scope === "POSITIONS")} runId={selected.id} />
          </Section>

          <Section
            title={to("cash")}
            description={to("cashHint")}
          >
            <Findings items={items.filter((item) => item.scope === "CASH")} runId={selected.id} />
          </Section>
        </>
      ) : (
        <Section title={to("past")}>
          <EmptyState
            icon={Scale}
            title={to("neverRun")}
            description={to("neverRunHint")}
          />
        </Section>
      )}

      <Section
        title={to("transfer")}
        description={to("transferHint")}
      >
        <TransferPanel portfolios={portfolios} activeId={active.id} />
      </Section>

      <Section
        title={to("splits")}
        description={to("splitsHint")}
      >
        <AdjustmentsPanel
          portfolioId={active.id}
          holdings={analytics.holdings}
          adjustments={adjustments}
        />
      </Section>
    </div>
  )
}
