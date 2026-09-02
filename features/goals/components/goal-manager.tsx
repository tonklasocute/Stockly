"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Pencil, Plus, Target, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"
import { GOAL_TYPES, type GoalProgress, type GoalType } from "@/domain/goals"
import type { Currency } from "@/domain/market"
import { apiFetch } from "@/lib/api-client"
import type { PortfolioGoalRow } from "@/types/database"
import { GoalDialog } from "./goal-dialog"
import { GoalProgressBar } from "./goal-progress-bar"

export type GoalCard = { row: PortfolioGoalRow; progress: GoalProgress }

export function GoalManager({
  portfolioId,
  baseCurrency,
  goals,
}: {
  portfolioId: string
  baseCurrency: Currency
  goals: GoalCard[]
}) {
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<PortfolioGoalRow | undefined>()

  const taken = goals.map((goal) => goal.row.type as GoalType)
  const allTaken = GOAL_TYPES.every((type) => taken.includes(type))

  const remove = useMutation({
    mutationFn: (row: PortfolioGoalRow) => apiFetch(`/api/goals/${row.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Goal removed.")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function openNew() {
    setEditing(undefined)
    setDialogOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {goals.length === 0
            ? "No goals set."
            : `${goals.length} of ${GOAL_TYPES.length} goal types in use.`}
        </p>
        <Button onClick={openNew} disabled={allTaken} className="gap-2 max-sm:h-11">
          <Plus className="size-4" aria-hidden />
          Add goal
        </Button>
      </div>

      {goals.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Target}
            title="No goals yet"
            description="Set a target and Stockly measures progress against it from your own transactions — portfolio value, invested capital, dividend income or total return."
            action={
              <Button onClick={openNew} className="gap-2">
                <Plus className="size-4" aria-hidden />
                Set a goal
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {goals.map(({ row, progress }) => (
            <li key={row.id} className="bg-card space-y-3 rounded-xl border p-4">
              <GoalProgressBar progress={progress} baseCurrency={baseCurrency} />
              {row.note && <p className="text-muted-foreground text-xs italic">{row.note}</p>}
              <div className="flex justify-end gap-1 border-t pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setEditing(row)
                    setDialogOpen(true)
                  }}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-loss gap-1.5"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm("Remove this goal? Nothing else changes.")) remove.mutate(row)
                  }}
                >
                  {remove.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden />
                  )}
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <GoalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        portfolioId={portfolioId}
        baseCurrency={baseCurrency}
        goal={editing}
        takenTypes={taken}
      />
    </div>
  )
}
