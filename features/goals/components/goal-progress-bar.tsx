import { GOAL_DEFINITIONS, type GoalProgress } from "@/domain/goals"
import {
  formatCurrency,
  formatDate,
  formatOptionalPercent,
  formatPercent,
} from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Locale } from "@/domain/locale"

/** A goal's target and current value, in whichever unit that goal is measured in. */
function stated(value: number, progress: GoalProgress, baseCurrency: string): string {
  return progress.unit === "percent"
    ? formatPercent(value, { signed: false })
    : formatCurrency(value, progress.currency ?? baseCurrency)
}

/**
 * One goal, with its definition beside it.
 *
 * The definition is not decoration: "invested capital" and "portfolio value" differ by exactly the
 * amount a user is most likely to misread, so the sentence saying which one this measures is part
 * of the figure.
 */
export function GoalProgressBar({
  progress,
  baseCurrency,
  className,
  locale,
}: {
  progress: GoalProgress
  baseCurrency: string
  className?: string
  /*
   * Passed in, because this component is rendered from both sides of the boundary: two Server
   * Components render it directly and `GoalManager` renders it inside a client tree. A hook would
   * break the first two and a server helper would break the third, so the caller — which always
   * knows which world it is in — supplies it.
   */
  locale: Locale
}) {
  const definition = GOAL_DEFINITIONS[progress.type]
  const filled = progress.progressPct === null ? 0 : Math.max(0, Math.min(progress.progressPct, 100))

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-sm font-medium">{definition.label}</span>
        <span className="tabular text-muted-foreground text-xs">
          {progress.progressPct === null ? "N/A" : formatOptionalPercent(progress.progressPct, { signed: false })}
        </span>
      </div>

      <div
        className="bg-muted h-2 overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={progress.progressPct ?? undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${definition.label} goal progress`}
      >
        <div
          className={cn("h-full rounded-full", progress.achieved ? "bg-gain" : "bg-primary")}
          style={{ width: `${filled}%` }}
        />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
        <span className="tabular">
          {progress.unavailableReason ? (
            <span className="text-muted-foreground">N/A</span>
          ) : (
            <>
              {stated(progress.current, progress, baseCurrency)}{" "}
              <span className="text-muted-foreground">
                of {stated(progress.target, progress, baseCurrency)}
              </span>
            </>
          )}
        </span>
        {progress.targetDate && (
          <span className="text-muted-foreground">
            by {formatDate(progress.targetDate, locale)}
            {progress.daysRemaining !== null &&
              (progress.daysRemaining >= 0
                ? ` · ${progress.daysRemaining} days left`
                : ` · ${Math.abs(progress.daysRemaining)} days ago`)}
          </span>
        )}
      </div>

      <p className="text-muted-foreground text-xs">
        {progress.unavailableReason ?? definition.measures}
      </p>
    </div>
  )
}
