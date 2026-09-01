import { cn } from "@/lib/utils"
import { formatPercent, formatSignedCurrency, toneOf } from "@/lib/format"

const TONE = {
  gain: "text-gain",
  loss: "text-loss",
  flat: "text-muted-foreground",
} as const

/** Every profit-and-loss figure in the app is coloured here, so gain/loss never drifts apart. */
export function Delta({
  value,
  currency = "USD",
  percent,
  className,
}: {
  value: number
  currency?: string
  percent?: number
  className?: string
}) {
  return (
    <span className={cn("tabular font-medium", TONE[toneOf(value)], className)}>
      {formatSignedCurrency(value, currency)}
      {percent !== undefined && (
        <span className="text-muted-foreground ml-1.5 font-normal">({formatPercent(percent)})</span>
      )}
    </span>
  )
}

export function Percent({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("tabular font-medium", TONE[toneOf(value)], className)}>
      {formatPercent(value)}
    </span>
  )
}
