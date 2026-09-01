"use client"

import { usePathname, useRouter } from "next/navigation"
import { Check, ChevronsUpDown, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import type { PortfolioRow } from "@/types/database"

export function PortfolioSwitcher({
  portfolios,
  activeId,
  onCreate,
}: {
  portfolios: PortfolioRow[]
  activeId: string | null
  onCreate: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const active = portfolios.find((p) => p.id === activeId)

  if (portfolios.length === 0) {
    return (
      <Button variant="outline" size="sm" onClick={onCreate} className="gap-2">
        <Plus className="size-4" aria-hidden />
        New portfolio
      </Button>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" />}
        className="max-w-[12rem] justify-between gap-2"
      >
        <span className="truncate">{active?.name ?? "Select portfolio"}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {portfolios.map((portfolio) => (
          <DropdownMenuItem
            key={portfolio.id}
            onSelect={() => router.push(`${pathname}?p=${portfolio.id}`)}
            className="gap-2"
          >
            <Check
              className={cn("size-4", portfolio.id === activeId ? "opacity-100" : "opacity-0")}
              aria-hidden
            />
            <span className="flex-1 truncate">{portfolio.name}</span>
            <span className="text-muted-foreground text-xs">{portfolio.currency}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onCreate} className="gap-2">
          <Plus className="size-4" aria-hidden />
          New portfolio
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
