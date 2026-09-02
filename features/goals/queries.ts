import "server-only"

import { baseCurrencyOf, type Currency } from "@/domain/market"
import { goalProgress, type DomainGoal, type GoalFacts, type GoalProgress } from "@/domain/goals"
import { createClient } from "@/lib/supabase/server"
import type { PortfolioGoalRow } from "@/types/database"

export async function listGoals(portfolioId: string): Promise<PortfolioGoalRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("portfolio_goals")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("created_at", { ascending: true })

  if (error) throw error
  // PostgREST serialises numeric as a JSON number; coerced defensively, as everywhere else.
  return (data ?? []).map((row) => ({ ...row, target_value: Number(row.target_value) }))
}

/** Row → the shape `domain/goals.ts` measures. A percentage goal carries no currency. */
export function toDomainGoal(row: PortfolioGoalRow): DomainGoal {
  return {
    type: row.type,
    targetValue: Number(row.target_value),
    currency: row.currency ? baseCurrencyOf(row.currency) : null,
    targetDate: row.target_date ? row.target_date.slice(0, 10) : null,
  }
}

export type GoalWithProgress = { row: PortfolioGoalRow; progress: GoalProgress }

/**
 * Goals with their progress.
 *
 * **Every figure comes from the caller's `GoalFacts`**, which is built from `loadAnalytics` — so a
 * goal reads exactly the numbers the dashboard does, and adding, editing or deleting one cannot
 * move a single one of them.
 */
export function withProgress(
  rows: readonly PortfolioGoalRow[],
  facts: GoalFacts,
  options: { now?: Date; convert?: (amount: number, from: Currency) => { value: number } | null } = {},
): GoalWithProgress[] {
  return rows.map((row) => ({ row, progress: goalProgress(toDomainGoal(row), facts, options) }))
}
