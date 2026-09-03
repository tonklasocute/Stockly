"use client"

import { useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"
import { PortfolioDialog } from "@/features/portfolios/components/portfolio-dialog"
import { NetworkStatus } from "@/features/pwa/components/network-status"
import { StockSearch } from "@/features/stocks/components/stock-search"
import { CommandPalette } from "@/features/personalization/components/command-palette"
import { LanguageSwitcher } from "@/features/i18n/components/language-switcher"
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
  unread = 0,
  children,
}: {
  portfolios: PortfolioRow[]
  email: string
  unread?: number
  children: React.ReactNode
}) {
  const t = useTranslations("navigation")
  const ts = useTranslations("settings")
  const [creating, setCreating] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const requestedId = useSearchParams().get("p")
  const activeId = portfolios.find((p) => p.id === requestedId)?.id ?? portfolios[0]?.id ?? null

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      {/*
        Mounted once for the whole app. It only ever navigates, so it needs no portfolio data
        beyond the names it offers to jump to — and no shortcut it registers fires while a text
        field has focus.
      */}
      <CommandPalette portfolios={portfolios} />
      <aside className="bg-sidebar hidden border-r lg:flex lg:flex-col lg:gap-6 lg:p-4">
        <div className="px-2 pt-2">
          <Wordmark />
        </div>
        <SidebarNav unread={unread} />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="bg-background/95 safe-top sticky top-0 z-30 flex h-14 items-center gap-2 border-b px-4 backdrop-blur">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger
              render={<Button variant="ghost" size="icon" aria-label={t("openMenu")} />}
              className="lg:hidden"
            >
              <Menu className="size-5" aria-hidden />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-4">
              <SheetTitle className="sr-only">{t("menu")}</SheetTitle>
              <div className="mb-6 px-2">
                <Wordmark />
              </div>
              <SidebarNav onNavigate={() => setMenuOpen(false)} unread={unread} />
              {/*
                On a narrow screen the header has no room for either control, so both live here.
                Language sits beside appearance because they are the same kind of decision — how
                the application looks and reads, never what it calculates.
              */}
              <div className="mt-4 space-y-1 border-t px-3 pt-4 sm:hidden">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">{ts("appearance.title")}</span>
                  <ThemeToggle />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-sm">{ts("language.label")}</span>
                  <LanguageSwitcher signedIn label={ts("language.label")} />
                </div>
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
              <LanguageSwitcher signedIn label={ts("language.label")} />
            </span>
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

      <MobileTabBar unread={unread} />
      <PortfolioDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
