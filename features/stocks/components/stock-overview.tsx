import { formatCompact, formatCurrency, formatOptional } from "@/lib/format"
import type { Quote } from "@/services/market-data/types"

/**
 * Provider coverage varies by plan, so every metric renders "N/A" rather than a fabricated 0 when
 * the field is missing.
 */
export function StockOverview({ quote }: { quote: Quote }) {
  const money = (value: number) => formatCurrency(value, quote.currency ?? "USD")

  const metrics: Array<{ label: string; value: string }> = [
    { label: "Previous close", value: formatOptional(quote.previousClose, money) },
    { label: "Open", value: formatOptional(quote.dayOpen, money) },
    { label: "Day high", value: formatOptional(quote.dayHigh, money) },
    { label: "Day low", value: formatOptional(quote.dayLow, money) },
    { label: "52 week high", value: formatOptional(quote.fiftyTwoWeekHigh, money) },
    { label: "52 week low", value: formatOptional(quote.fiftyTwoWeekLow, money) },
    { label: "Volume", value: formatOptional(quote.volume, (v) => formatCompact(v)) },
    { label: "Avg volume", value: formatOptional(quote.averageVolume, (v) => formatCompact(v)) },
  ]

  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {metrics.map(({ label, value }) => (
        <div key={label} className="space-y-0.5">
          <dt className="text-muted-foreground text-xs">{label}</dt>
          <dd className="tabular text-sm font-medium">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
