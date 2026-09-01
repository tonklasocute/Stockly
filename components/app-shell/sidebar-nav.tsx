"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { NAV_ITEMS } from "./nav-items"

/** Keeps the selected portfolio when moving between pages. */
export function useHrefWithPortfolio() {
  const portfolioId = useSearchParams().get("p")
  return (href: string) => (portfolioId ? `${href}?p=${portfolioId}` : href)
}

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const withPortfolio = useHrefWithPortfolio()

  return (
    <nav className="grid gap-0.5" aria-label="Main">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={withPortfolio(href)}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
            {label}
          </Link>
        )
      })}
    </nav>
  )
}

export function MobileTabBar() {
  const pathname = usePathname()
  const withPortfolio = useHrefWithPortfolio()
  const items = NAV_ITEMS.filter((item) => item.mobile)

  return (
    <nav
      aria-label="Main"
      className="bg-background/95 safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t pt-1 backdrop-blur lg:hidden"
    >
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`)
        return (
          <Link
            key={href}
            href={withPortfolio(href)}
            aria-current={active ? "page" : undefined}
            /* 44px minimum touch target. */
            className={cn(
              "flex min-h-11 flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-medium",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          >
            <Icon className="size-5" aria-hidden />
            <span className="truncate">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
