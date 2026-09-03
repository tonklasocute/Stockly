import { CircleAlert, Info, TriangleAlert } from "lucide-react"
import type { Insight, InsightSeverity } from "@/domain/insights"
import { cn } from "@/lib/utils"
import { getTranslations } from "next-intl/server"

const ICONS: Record<InsightSeverity, typeof Info> = {
  WARNING: TriangleAlert,
  NOTICE: CircleAlert,
  INFO: Info,
}

/**
 * Severity is spelled out beside every insight, not just coloured. The app-wide rule — colour never
 * carries meaning alone — matters more here than on a P&L figure, because there is no sign or
 * percentage to fall back on.
 */
const TONE: Record<InsightSeverity, string> = {
  WARNING: "text-loss",
  NOTICE: "text-foreground",
  INFO: "text-muted-foreground",
}

export async function InsightList({
  insights,
  limit,
  className,
}: {
  insights: readonly Insight[]
  limit?: number
  className?: string
}) {
  const t = await getTranslations("intelligence")
  const visible = limit ? insights.slice(0, limit) : insights

  if (visible.length === 0) {
    return (
      <p className={cn("text-muted-foreground py-6 text-center text-sm", className)}>{t("insights.empty")}</p>
    )
  }

  return (
    <ul className={cn("divide-y", className)}>
      {visible.map((insight) => {
        const Icon = ICONS[insight.severity]
        return (
          <li key={insight.code} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
            <Icon className={cn("mt-0.5 size-4 shrink-0", TONE[insight.severity])} aria-hidden />
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-medium">{insight.title}</p>
              <p className="text-muted-foreground text-xs">{insight.detail}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
                {insight.severity}
              </p>
              {insight.metric && (
                <p className="tabular text-xs font-medium">{insight.metric.value}</p>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
