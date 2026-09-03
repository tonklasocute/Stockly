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

export const metadata: Metadata = { title: "Reconciliation" }

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
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Reconciliation</h1>
        <p className="text-muted-foreground text-sm">
          {active.name} · compare a broker statement against these records. A difference is
          described, never applied — nothing here changes a transaction, a holding or a balance.
        </p>
      </div>

      <Section
        title="Cash by currency"
        description="What this portfolio's ledger says, one currency at a time. Nothing is converted, so a statement can be compared against it directly."
      >
        {analytics.cashByCurrency.length === 0 ? (
          <p className="text-muted-foreground py-4 text-sm">
            No cash movement recorded in any currency yet.
          </p>
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
        title="Compare a statement"
        description="Paste what your broker reports. Running this twice produces the same result and changes nothing either time."
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
              <Metric label="Positions compared" value={summary.positions.total} />
              <Metric
                label="Position differences"
                value={summary.positions.differences}
                hint={`${summary.positions.unresolved} to review`}
              />
              <Metric label="Balances compared" value={summary.cash.total} />
              <Metric
                label="Balance differences"
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
            title="Positions"
            description="A difference does not mean these records are wrong. It means two records disagree."
          >
            <Findings items={items.filter((item) => item.scope === "POSITIONS")} runId={selected.id} />
          </Section>

          <Section
            title="Cash"
            description="Each currency is compared against its own balance. A dollar balance is never weighed against a baht one."
          >
            <Findings items={items.filter((item) => item.scope === "CASH")} runId={selected.id} />
          </Section>
        </>
      ) : (
        <Section title="Past comparisons">
          <EmptyState
            icon={Scale}
            title="No reconciliation has been run yet"
            description="Paste a statement above to compare it against this portfolio. It records what it finds and changes nothing."
          />
        </Section>
      )}

      <Section
        title="Move holdings to another portfolio"
        description="A transfer re-parents the transactions. Nothing is sold, so no profit or loss is created."
      >
        <TransferPanel portfolios={portfolios} activeId={active.id} />
      </Section>

      <Section
        title="Splits"
        description="The one corporate action that changes a share count with no transaction behind it. Recording it here restates the history without rewriting a single trade."
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
