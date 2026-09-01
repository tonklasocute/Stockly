"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { PortfolioDialog } from "@/features/portfolios/components/portfolio-dialog"
import { NetworkStatus } from "@/features/pwa/components/network-status"
import { StockSearch } from "@/features/stocks/components/stock-search"
import type { PortfolioRow } from "@/types/database"
import { MobileTabBar, SidebarNav } from "./sidebar-nav"
import { PortfolioSwitcher } from "./portfolio-switcher"
import { ThemeToggle } from "./theme-toggle"
import { UserMenu } from "./user-menu"

function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-2.5 pointer-coarse:-my-2 pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:py-2"
    >
      <span className="bg-foreground text-background flex size-7 items-center justify-center rounded-md text-xs font-bold">
        S
      </span>
      <span className={cn("font-semibold tracking-tight", compact && "max-sm:sr-only")}>
        Stockly
      </span>
    </Link>
  )
}

export function AppChrome({
  portfolios,
  email,
  children,
}: {
  portfolios: PortfolioRow[]
  email: string
  children: React.ReactNode
}) {
  const [creating, setCreating] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const requestedId = useSearchParams().get("p")
  const activeId = portfolios.find((p) => p.id === requestedId)?.id ?? portfolios[0]?.id ?? null

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <aside className="bg-sidebar hidden border-r lg:flex lg:flex-col lg:gap-6 lg:p-4">
        <div className="px-2 pt-2">
          <Wordmark />
        </div>
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="bg-background/95 safe-top sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              render={<Button variant="ghost" size="icon" aria-label="Open menu" />}
              className="lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-4">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <div className="mb-6 px-2">
                <Wordmark />
              </div>
              <SidebarNav onNavigate={() => setMenuOpen(false)} />
              <div className="mt-4 flex items-center justify-between border-t px-3 pt-4 sm:hidden">
                <span className="text-muted-foreground text-sm">Appearance</span>
                <ThemeToggle />
              </div>
            </SheetContent>
          </Sheet>

          <span className="lg:hidden">
            <Wordmark compact />
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <StockSearch />
            <PortfolioSwitcher
              portfolios={portfolios}
              activeId={activeId}
              onCreate={() => setCreating(true)}
            />
            <span className="max-sm:hidden">
              <ThemeToggle />
            </span>
            <UserMenu email={email} />
          </div>
        </header>

        <NetworkStatus />

        {/* Bottom padding clears the mobile tab bar. */}
        <main className="min-w-0 flex-1 px-4 pt-5 pb-24 sm:px-6 lg:pb-8">{children}</main>
      </div>

      <MobileTabBar />
      <PortfolioDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
