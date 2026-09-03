"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { apiFetch } from "@/lib/api-client"
import type { PortfolioRow } from "@/types/database"
import { PortfolioDialog } from "./portfolio-dialog"
import { useTranslations } from "next-intl"

export function PortfolioManager({ portfolios }: { portfolios: PortfolioRow[] }) {
  const t = useTranslations("portfolios")
  const router = useRouter()
  const [editing, setEditing] = useState<PortfolioRow | undefined>()
  const [open, setOpen] = useState(false)

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/portfolios/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("deleted"))
      router.push("/dashboard")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground text-sm">{t("deleteWarning")}</p>
        </div>
        <Button
          size="sm"
          className="gap-2"
          onClick={() => {
            setEditing(undefined)
            setOpen(true)
          }}
        >
          <Plus className="size-4" aria-hidden />{t("new")}</Button>
      </div>

      <ul className="divide-y overflow-hidden rounded-xl border">
        {portfolios.map((portfolio) => (
          <li key={portfolio.id} className="bg-card flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{portfolio.name}</p>
              <p className="text-muted-foreground text-xs">{portfolio.currency}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Edit ${portfolio.name}`}
              onClick={() => {
                setEditing(portfolio)
                setOpen(true)
              }}
            >
              <Pencil className="size-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${portfolio.name}`}
              disabled={remove.isPending}
              onClick={() => {
                if (
                  confirm(`Delete "${portfolio.name}" and all of its transactions? This cannot be undone.`)
                ) {
                  remove.mutate(portfolio.id)
                }
              }}
            >
              <Trash2 className="text-destructive size-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      <PortfolioDialog open={open} onOpenChange={setOpen} portfolio={editing} />
    </section>
  )
}
