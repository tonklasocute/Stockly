import { cn } from "@/lib/utils"

/**
 * Deliberately not a shadcn Card: the dashboard reads better as one bordered grid than as a row
 * of floating boxes, so these share hairline dividers instead of stacking their own chrome.
 */
export function StatCard({
  label,
  value,
  hint,
  emphasis,
  className,
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  emphasis?: boolean
  className?: string
}) {
  return (
    <div className={cn("bg-card flex flex-col gap-1.5 p-4 sm:p-5", className)}>
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      <span
        className={cn(
          "tabular font-semibold tracking-tight",
          emphasis ? "text-2xl sm:text-3xl" : "text-xl sm:text-2xl",
        )}
      >
        {value}
      </span>
      {hint ? <span className="text-sm">{hint}</span> : null}
    </div>
  )
}

/** Wraps StatCards in a single hairline grid — one border, not four. */
export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "bg-border grid grid-cols-2 gap-px overflow-hidden rounded-xl border lg:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  )
}
