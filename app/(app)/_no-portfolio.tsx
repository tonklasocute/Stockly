"use client"

import { useState } from "react"
import { FolderPlus, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"
import { PortfolioDialog } from "@/features/portfolios/components/portfolio-dialog"

/** Shown on every page until the user has at least one portfolio to put transactions in. */
export function NoPortfolio() {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-xl border">
      <EmptyState
        icon={FolderPlus}
        title="Create your first portfolio"
        description="A portfolio holds your transactions. Group them by broker, strategy or market — you can have as many as you like."
        action={
          <Button onClick={() => setOpen(true)} className="gap-2">
            <Plus className="size-4" aria-hidden />
            New portfolio
          </Button>
        }
      />
      <PortfolioDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
