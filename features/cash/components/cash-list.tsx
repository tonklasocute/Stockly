"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Banknote, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EmptyState } from "@/components/empty-state"
import { apiFetch } from "@/lib/api-client"
import { formatCurrency, formatDate } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CashTransactionRow } from "@/types/database"
import { CashDialog } from "./cash-dialog"
import { useAppLocale } from "@/lib/i18n/locale"

export function CashList({
  transactions,
  portfolioId,
  currency,
}: {
  transactions: CashTransactionRow[]
  portfolioId: string
  currency: string
}) {
  const locale = useAppLocale()
  const router = useRouter()
  const [editing, setEditing] = useState<CashTransactionRow | undefined>()
  const [dialogOpen, setDialogOpen] = useState(false)

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/cash/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Cash transaction deleted.")
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
      <div className="flex justify-end">
        <Button onClick={openNew} className="gap-2 max-sm:h-11 max-sm:w-full">
          <Plus className="size-4" aria-hidden />
          Record cash
        </Button>
      </div>

      {transactions.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Banknote}
            title="No cash movements yet"
            description="Record the deposits that funded your trades so your cash balance and allocation are accurate."
            action={
              <Button onClick={openNew} className="gap-2 max-sm:h-11">
                <Plus className="size-4" aria-hidden />
                Record cash
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border">
          {transactions.map((row) => (
            <li key={row.id} className="bg-card flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn(
                      "capitalize",
                      row.kind === "deposit" ? "border-gain/40 text-gain" : "border-loss/40 text-loss",
                    )}
                  >
                    {row.kind}
                  </Badge>
                  <span className="text-muted-foreground text-xs">
                    {formatDate(row.occurred_on, locale)}
                  </span>
                </div>
                {row.notes && (
                  <p className="text-muted-foreground mt-1 truncate text-xs">{row.notes}</p>
                )}
              </div>
              {/* The sign is explicit, so direction never depends on colour alone. */}
              <span
                className={cn(
                  "tabular font-semibold",
                  row.kind === "deposit" ? "text-gain" : "text-loss",
                )}
              >
                {row.kind === "deposit" ? "+" : "−"}
                {formatCurrency(row.amount, currency)}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for the ${row.kind} on ${row.occurred_on}`}
                    />
                  }
                >
                  <MoreHorizontal className="size-4" aria-hidden />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(row)
                      setDialogOpen(true)
                    }}
                    className="gap-2"
                  >
                    <Pencil className="size-4" aria-hidden />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    variant="destructive"
                    className="gap-2"
                    onSelect={() => {
                      if (confirm(`Delete this ${row.kind}?`)) remove.mutate(row.id)
                    }}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          ))}
        </ul>
      )}

      <CashDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        portfolioId={portfolioId}
        transaction={editing}
      />
    </div>
  )
}
