"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { TIME_RANGES, type TimeRange } from "@/domain/analytics"
import { cn } from "@/lib/utils"

/**
 * The one date-range control. Every dated view reads `?range=` from the URL, so the choice is
 * shareable, survives a reload, and is readable by Server Components — and there is exactly one
 * implementation to keep consistent instead of one per page.
 */
export function RangeFilter({ current }: { current: TimeRange }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function select(range: TimeRange) {
    const params = new URLSearchParams(searchParams)
    params.set("range", range)
    router.replace(`${pathname}?${params}`, { scroll: false })
  }

  return (
    <div
      role="tablist"
      aria-label="Time range"
      className="-mx-1 flex max-w-full snap-x gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {TIME_RANGES.map((range) => (
        <button
          key={range}
          type="button"
          role="tab"
          aria-selected={current === range}
          onClick={() => select(range)}
          className={cn(
            "min-h-8 shrink-0 snap-start rounded-lg px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-3",
            current === range
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:bg-accent/60",
          )}
        >
          {range}
        </button>
      ))}
    </div>
  )
}
