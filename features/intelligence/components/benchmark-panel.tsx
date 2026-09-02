import { Metric } from "@/components/metric"
import { formatOptionalPercent } from "@/lib/format"
import type { BenchmarkComparison } from "../loader"

/**
 * Portfolio against benchmark, time-weighted on both sides.
 *
 * The difference is the number a user actually wants, and it is the one most easily made
 * meaningless — by counting a deposit as performance, or by subtracting a return measured in
 * another currency. Both are handled upstream and both are stated here rather than hidden: a null
 * difference always comes with the sentence explaining it.
 */
export function BenchmarkPanel({ comparison }: { comparison: BenchmarkComparison | null }) {
  if (!comparison) {
    return (
      <p className="text-muted-foreground py-6 text-center text-sm">
        No benchmark selected. Choose one to compare this portfolio&apos;s time-weighted return
        against an index.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <dl className="grid gap-4 sm:grid-cols-3">
        <Metric
          label="Portfolio"
          value={formatOptionalPercent(comparison.portfolioReturnPct)}
          hint={`Time-weighted${comparison.currencyMismatch ? `, in ${comparison.currencyMismatch.portfolio}` : ""}`}
        />
        <Metric
          label={comparison.benchmark.name}
          value={formatOptionalPercent(comparison.benchmarkReturnPct)}
          hint={
            comparison.observations > 0
              ? `${comparison.observations} closes${comparison.currencyMismatch ? `, in ${comparison.benchmark.currency}` : ""}`
              : "No index history"
          }
        />
        <Metric
          label="Difference"
          value={
            comparison.differencePct === null ? (
              <span className="text-muted-foreground">N/A</span>
            ) : (
              formatOptionalPercent(comparison.differencePct)
            )
          }
          hint="Percentage points"
        />
      </dl>

      {comparison.unavailableReason && (
        <p className="text-muted-foreground border-t pt-3 text-xs">{comparison.unavailableReason}</p>
      )}
    </div>
  )
}
