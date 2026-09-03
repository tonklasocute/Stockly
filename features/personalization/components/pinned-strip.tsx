import Link from "next/link"
import { Pin, Clock } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import type { PinnableKind, PinnedItem } from "@/domain/personalization"

/**
 * Pinned and recently-viewed items.
 *
 * Both are the same shape and the same rendering, which is why they share a file: a kind, an
 * opaque reference and a label the user will recognise. Neither carries a figure — a pin is a
 * bookmark, not a cached price — so neither can go stale and neither needs invalidating when a
 * price moves.
 */
const HREF: Record<PinnableKind, (ref: string) => string> = {
  // A stock's reference is a symbolKey ("US:NVDA"); the route wants the bare symbol.
  stock: (ref) => `/stocks/${ref.includes(":") ? ref.split(":")[1] : ref}`,
  portfolio: (ref) => `/portfolio?p=${ref}`,
  view: (ref) => `/portfolio?view=${ref}`,
  goal: () => "/goals",
  screen: () => "/screener",
}

function Strip({
  items,
  emptyTitle,
  emptyDescription,
  icon: Icon,
}: {
  items: readonly PinnedItem[]
  emptyTitle: string
  emptyDescription: string
  icon: typeof Pin
}) {
  if (items.length === 0) {
    return <EmptyState icon={Icon} title={emptyTitle} description={emptyDescription} />
  }

  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={`${item.kind}:${item.ref}`}>
          <Link
            href={HREF[item.kind](item.ref)}
            className="bg-card hover:bg-muted/60 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors pointer-coarse:min-h-11"
          >
            <span className="text-muted-foreground text-xs capitalize">{item.kind}</span>
            <span className="font-medium">{item.label}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

export function PinnedStrip({ items }: { items: readonly PinnedItem[] }) {
  return (
    <Strip
      items={items}
      icon={Pin}
      emptyTitle="Nothing pinned"
      emptyDescription="Pin a stock, a portfolio or a saved view to reach it from here."
    />
  )
}

export function RecentStrip({ items }: { items: readonly PinnedItem[] }) {
  return (
    <Strip
      items={items}
      icon={Clock}
      emptyTitle="Nothing viewed yet"
      emptyDescription="The last few stocks and portfolios you open appear here."
    />
  )
}
