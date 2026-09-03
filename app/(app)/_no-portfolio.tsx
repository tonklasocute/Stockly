"use client"

import { useState } from "react"
import { FolderPlus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"
import { PortfolioDialog } from "@/features/portfolios/components/portfolio-dialog"
import { useTranslations } from "next-intl"

/** Shown on every page until the user has at least one portfolio to put transactions in. */
export function NoPortfolio() {
  const t = useTranslations("portfolios")
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl border">
      <EmptyState
        icon={FolderPlus}
        title={t("createFirst")}
        description={t("createFirstBody")}
        action={
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="size-4" aria-hidden />{t("newPortfolio")}</Button>
        }
      />
      <PortfolioDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
