import type { Metadata } from "next"
import { Section } from "@/components/metric"
import { GoalManager } from "@/features/goals/components/goal-manager"
import { ProjectionPanel } from "@/features/goals/components/projection-panel"
import { loadIntelligence } from "@/features/intelligence/loader"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { listCashTransactions } from "@/features/cash/queries"
import { averageMonthlyContribution } from "@/domain/goals"
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

  // The projection's default contribution comes from the user's own deposits, not from a number
  // Stockly picked — and is null, leaving the field at zero, when there is no history to average.
  const suggested = averageMonthlyContribution(
    cashRows.map((row) => ({
      occurredOn: row.occurred_on.slice(0, 10),
      kind: row.kind,
      amount: Number(row.amount),
    })),
  )

  const valueGoal = bundle.goals.find((goal) => goal.row.type === "PORTFOLIO_VALUE")

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Goals</h1>
        <p className="text-muted-foreground text-sm">{active.name}</p>
      </div>

      <GoalManager
        portfolioId={active.id}
        baseCurrency={bundle.baseCurrency}
        goals={bundle.goals}
      />

      <Section
        title="Scenario modelling"
        description="What the arithmetic says under assumptions you choose. Not a prediction."
      >
        <ProjectionPanel
          startValue={bundle.analytics.totalValue}
          target={valueGoal?.progress.target ?? null}
          currency={bundle.baseCurrency}
          suggestedContribution={suggested}
        />
      </Section>
    </div>
  )
}
