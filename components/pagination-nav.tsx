import Link from "next/link"
import { getTranslations } from "next-intl/server"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Server-rendered pagination: links, not buttons, so a page is bookmarkable and works without JS.
 */
export async function PaginationNav({
  page,
  pageCount,
  total,
  baseParams,
  label,
}: {
  page: number
  pageCount: number
  total: number
  /** Everything except `page`, so filters survive paging. */
  baseParams: Record<string, string | undefined>
  label: string
}) {
  if (pageCount <= 1) return null

  const tc = await getTranslations("common")

  const href = (target: number) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(baseParams)) if (value) params.set(key, value)
    params.set("page", String(target))
    return `?${params}`
  }

  const linkClass = "inline-flex min-h-9 items-center gap-1 rounded-lg border px-3 text-sm font-medium"

  return (
    <nav
      aria-label={tc("table.pagination", { label })}
      className="flex items-center justify-between gap-3 pt-1"
    >
      <p className="text-muted-foreground text-sm" aria-live="polite">
        {tc("table.pageSummary", { page, pageCount, total, label })}
      </p>
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={linkClass} rel="prev">
            <ChevronLeft className="size-4" aria-hidden />
            {tc("actions.previous")}
          </Link>
        ) : (
          <span className={cn(linkClass, "text-muted-foreground opacity-50")} aria-disabled>
            <ChevronLeft className="size-4" aria-hidden />
            {tc("actions.previous")}
          </span>
        )}
        {page < pageCount ? (
          <Link href={href(page + 1)} className={linkClass} rel="next">
            {tc("actions.next")}
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : (
          <span className={cn(linkClass, "text-muted-foreground opacity-50")} aria-disabled>
            {tc("actions.next")}
            <ChevronRight className="size-4" aria-hidden />
          </span>
        )}
      </div>
    </nav>
  )
}
