import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Metric, Section } from "@/components/metric"
import { GOAL_DEFINITIONS } from "@/domain/goals"
import { averageMonthlyContribution } from "@/domain/goals"
import {
  SCENARIO_LABELS,
  SCENARIO_RETURNS,
  planGoal,
  requiredContribution,
  yearsUntil,
} from "@/domain/simulation"
import { DataLabel } from "@/features/simulations/components/assumptions"
import { GoalManager } from "@/features/goals/components/goal-manager"
import { loadIntelligence } from "@/features/intelligence/loader"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { listCashTransactions } from "@/features/cash/queries"
import { formatCurrency, formatDate, formatPercent } from "@/lib/format"
import { NoPortfolio } from "../_no-portfolio"

export const metadata: Metadata = { title: "Goals" }

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const { p } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const [bundle, cashRows] = await Promise.all([
    loadIntelligence(active.id),
    listCashTransactions(active.id),
  ])

  // The user's own average, and null when there is no history to average — an assumption Stockly
  // cannot ground in something real is one the user supplies.
  const contribution =
    averageMonthlyContribution(
      cashRows.map((row) => ({
        occurredOn: row.occurred_on.slice(0, 10),
        kind: row.kind,
        amount: Number(row.amount),
      })),
    ) ?? 0

  const now = new Date()

  /**
   * A base-case projection per goal, so the page answers "where does this end up" without leaving
   * it. Every assumption is stated in the row; the full workspace is one tap away for changing them.
   */
  const outlooks = bundle.goals
    .filter(({ progress }) => progress.progressPct !== null)
    .map(({ row, progress }) => {
      const years = yearsUntil(progress.targetDate, now) ?? 10
      const shared = {
        currentValue: progress.current,
        targetValue: progress.target,
        annualReturn: SCENARIO_RETURNS.BASE,
        years,
        frequency: "MONTHLY" as const,
        timing: "END" as const,
      }
      return {
        row,
        progress,
        years,
        plan: planGoal({
          ...shared,
          contribution: Math.max(0, contribution),
          contributionGrowth: 0,
          inflationRate: null,
          currency: bundle.baseCurrency,
        }),
        required: requiredContribution(shared),
      }
    })

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Goals</h1>
          <p className="text-muted-foreground text-sm">{active.name}</p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href={`/simulations?p=${active.id}`} />}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          Plan a scenario
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </div>

      <GoalManager
        portfolioId={active.id}
        baseCurrency={bundle.baseCurrency}
        goals={bundle.goals}
      />

      {outlooks.length > 0 && (
        <Section
          title="Base-case outlook"
          description={`At ${formatPercent(SCENARIO_RETURNS.BASE * 100, { signed: false })} a year with ${formatCurrency(contribution, bundle.baseCurrency)} a month — an example assumption, not a forecast.`}
          action={
            <Button
              nativeButton={false}
              render={<Link href={`/simulations?p=${active.id}`} />}
              variant="outline"
              size="sm"
            >
              Change assumptions
            </Button>
          }
        >
          <ul className="divide-y">
            {outlooks.map(({ row, progress, years, plan, required }) => (
              <li key={row.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{GOAL_DEFINITIONS[row.type].label}</span>
                  <DataLabel kind="PROJECTED" />
                  <span className="text-muted-foreground text-xs">
                    over {years.toFixed(1)} years
                    {progress.targetDate ? ` · target ${formatDate(progress.targetDate)}` : ""}
                  </span>
                </div>

                <dl className="grid gap-4 sm:grid-cols-4">
                  <Metric
                    label="Target"
                    value={
                      progress.unit === "percent"
                        ? formatPercent(progress.target, { signed: false })
                        : formatCurrency(progress.target, bundle.baseCurrency)
                    }
                  />
                  <Metric
                    label="Scenario value"
                    value={
                      plan.ok
                        ? formatCurrency(plan.value.projectedValue, bundle.baseCurrency)
                        : "N/A"
                    }
                    hint={SCENARIO_LABELS.BASE + " scenario"}
                  />
                  <Metric
                    label="Projected gap"
                    value={
                      !plan.ok
                        ? "N/A"
                        : plan.value.projectedGap === 0
                          ? "Target met"
                          : formatCurrency(plan.value.projectedGap, bundle.baseCurrency)
                    }
                  />
                  <Metric
                    label="Contribution needed"
                    value={
                      required.ok
                        ? formatCurrency(required.value, bundle.baseCurrency)
                        : "N/A"
                    }
                    hint="a month, to land on the target"
                  />
                </dl>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
            <strong className="text-foreground font-medium">These are not predictions.</strong>{" "}
            Every figure above is arithmetic on the assumption stated in the heading. Change it, or
            model a different one, in Planning.
          </p>
        </Section>
      )}
    </div>
  )
}
