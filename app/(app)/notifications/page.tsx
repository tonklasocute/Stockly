import type { Metadata } from "next"
import Link from "next/link"
import { PaginationNav } from "@/components/pagination-nav"
import { Button } from "@/components/ui/button"
import { NotificationList } from "@/features/notifications/components/notification-list"
import { listNotifications, unreadCount } from "@/features/notifications/queries"
import { toPage } from "@/lib/pagination"
import { cn } from "@/lib/utils"
import type { NotificationCategory } from "@/types/database"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("notifications") }
}

/** `key` is the query value; `label` is its key in the `notifications` namespace. */
const FILTERS = [
  { key: "", label: "all" },
  { key: "price", label: "price" },
  { key: "portfolio", label: "portfolio" },
  { key: "dividend", label: "dividend" },
  { key: "system", label: "system" },
] as const

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; category?: string }>
}) {
  const tNav = await getTranslations("navigation")
  const t = await getTranslations("notifications")
  const { page: pageParam, category: rawCategory } = await searchParams
  const category = FILTERS.some((f) => f.key && f.key === rawCategory)
    ? (rawCategory as NotificationCategory)
    : undefined

  const [result, unread] = await Promise.all([
    listNotifications(toPage(pageParam), category),
    unreadCount(),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("notifications")}</h1>
          <p className="text-muted-foreground text-sm">
            {unread > 0 ? `${unread} unread` : "You are all caught up"}
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href="/settings/notifications" />}
          variant="outline"
          size="sm"
        >{t("settings")}</Button>
      </div>

      <nav aria-label={t("filter")} className="flex gap-1 overflow-x-auto">
        {FILTERS.map((filter) => {
          const selected = (rawCategory ?? "") === filter.key
          return (
            <Link
              key={filter.key || "all"}
              href={filter.key ? `?category=${filter.key}` : "?"}
              aria-current={selected ? "page" : undefined}
              className={cn(
                "min-h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:justify-center pointer-coarse:px-3",
                "inline-flex items-center",
                selected
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {t(filter.label)}
            </Link>
          )
        })}
      </nav>

      <NotificationList notifications={result.rows} unread={unread} />

      <PaginationNav
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        baseParams={{ category: rawCategory }}
        label="notifications"
      />
    </div>
  )
}
