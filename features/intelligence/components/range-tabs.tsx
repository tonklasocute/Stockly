"use client"

import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { REVIEW_RANGES, type ReviewRange } from "../range"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

/**
 * The review period, kept in the URL so a link to a review is a link to *that* review.
 *
 * Links rather than buttons: each range is a real, shareable address, and the server re-derives the
 * page from it — there is no client state to keep in sync.
 */
export function RangeTabs({
  current,
  portfolioId,
}: {
  current: ReviewRange
  portfolioId: string
}) {
  const t = useTranslations("intelligence")
  const pathname = usePathname()
  const params = useSearchParams()

  function href(range: ReviewRange) {
    const next = new URLSearchParams(params.toString())
    next.set("range", range)
    next.set("p", portfolioId)
    return `${pathname}?${next.toString()}`
  }

  return (
    <nav aria-label={t("review.period")} className="bg-muted/60 flex gap-0.5 rounded-lg p-0.5">
      {REVIEW_RANGES.map((range) => (
        <Link
          key={range}
          href={href(range)}
          aria-current={range === current ? "page" : undefined}
          className={cn(
            "tap rounded-md px-2.5 py-1 text-xs font-medium transition-colors pointer-coarse:px-3 pointer-coarse:py-2",
            range === current
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {range}
        </Link>
      ))}
    </nav>
  )
}
