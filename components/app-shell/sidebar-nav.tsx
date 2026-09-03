"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { NAV_ITEMS } from "./nav-items"

/** Keeps the selected portfolio when moving between pages. */
export function useHrefWithPortfolio() {
  const portfolioId = useSearchParams().get("p")
  return (href: string) => (portfolioId ? `${href}?p=${portfolioId}` : href)
}

/** A small count, capped so a long-neglected inbox cannot stretch the row. */
function Badge({ count }: { count: number }) {
  const t = useTranslations("notifications")
  if (count <= 0) return null
  return (
    <span
      className="bg-foreground text-background ml-auto inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
      /* Pluralised by ICU, not by a ternary: Thai has one form and English has two. */
      aria-label={t("unreadCount", { count })}
    >
      {count > 99 ? "99+" : count}
    </span>
  )
}

export function SidebarNav({
  onNavigate,
  unread = 0,
}: {
  onNavigate?: () => void
  unread?: number
}) {
  const pathname = usePathname()
  const withPortfolio = useHrefWithPortfolio()
  const t = useTranslations("navigation")

  return (
    <nav className="grid gap-0.5" aria-label={t("primary")}>
      {NAV_ITEMS.map(({ href, label, icon: Icon, badge }) => {
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
            {t(label)}
            {badge === "unread" && <Badge count={unread} />}
          </Link>
        )
      })}
    </nav>
  )
}

export function MobileTabBar({ unread = 0 }: { unread?: number }) {
  const pathname = usePathname()
  const withPortfolio = useHrefWithPortfolio()
  const t = useTranslations("navigation")
  const tn = useTranslations("notifications")
  const items = NAV_ITEMS.filter((item) => item.mobile)

  return (
    <nav
      aria-label={t("primary")}
      className="bg-background/95 safe-bottom fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t pt-1 backdrop-blur lg:hidden"
    >
      {items.map(({ href, label, icon: Icon, badge }) => {
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
            <span className="relative">
              <Icon className="size-5" aria-hidden />
              {badge === "unread" && unread > 0 && (
                <span
                  className="bg-foreground text-background absolute -top-1.5 -right-2 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold tabular-nums"
                  aria-label={tn("unreadCount", { count: unread })}
                >
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </span>
            <span className="truncate">{t(label)}</span>
          </Link>
        )
      })}
    </nav>
  )
}
