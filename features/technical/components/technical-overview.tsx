import { Info } from "lucide-react"
import { Metric } from "@/components/metric"
import { SIGNAL_LABELS, type TechnicalSnapshot } from "@/domain/technical"
import { formatCompact, formatCurrency, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"

const TREND_LABEL: Record<string, string> = {
  bullish: "Bullish",
  bearish: "Bearish",
  neutral: "Neutral",
}

const STAGE_LABEL: Record<string, string> = {
  accumulation: "Accumulation",
  uptrend: "Uptrend",
  distribution: "Distribution",
  downtrend: "Downtrend",
  unknown: "Not enough history",
}

/** Trend is stated as a word with a shape, never as a colour alone. */
function TrendBadge({ trend }: { trend: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm font-medium",
        trend === "bullish" ? "text-gain" : trend === "bearish" ? "text-loss" : "text-muted-foreground",
      )}
    >
      <span aria-hidden>{trend === "bullish" ? "▲" : trend === "bearish" ? "▼" : "■"}</span>
      {TREND_LABEL[trend] ?? "Neutral"}
    </span>
  )
}

export function TechnicalOverview({
  snapshot,
  calculatedAt,
  stale,
  currency = "USD",
}: {
  snapshot: TechnicalSnapshot
  calculatedAt: string
  stale: boolean
  currency?: string
}) {
  if (snapshot.candleCount === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Not enough price history to compute technical indicators for this stock.
      </p>
    )
  }

  const optional = (value: number | null, digits = 1) =>
    value === null ? "N/A" : value.toFixed(digits)

  return (
    <div className="space-y-4">
      {/* A cached reading must never be presented as a live one. */}
      {stale && (
        <p className="text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed px-3 py-2 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Technical data may be delayed — last calculated {formatTime(calculatedAt)}. The price above
          is live; these indicators are not.
        </p>
      )}

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <p className="text-muted-foreground text-xs">Trend</p>
          <TrendBadge trend={snapshot.trend} />
        </div>
        <div>
          <p className="text-muted-foreground text-xs">Stage</p>
          <p className="text-sm font-medium">{STAGE_LABEL[snapshot.stage]}</p>
        </div>
        {snapshot.score !== null && (
          <div>
            <p className="text-muted-foreground text-xs">Technical score</p>
            <p className="tabular text-sm font-medium">
              {snapshot.score} <span className="text-muted-foreground">/ 100</span>
            </p>
          </div>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Metric label="RSI (14)" value={optional(snapshot.rsi)} />
        <Metric
          label="MACD"
          value={
            snapshot.macd === null || snapshot.macdSignal === null
              ? "N/A"
              : snapshot.macd > snapshot.macdSignal
                ? "Above signal"
                : "Below signal"
          }
        />
        <Metric label="ADX (14)" value={optional(snapshot.adx)} />
        <Metric
          label="Relative volume"
          value={snapshot.relativeVolume === null ? "N/A" : `${snapshot.relativeVolume.toFixed(1)}×`}
        />
        <Metric
          label="EMA 50"
          value={snapshot.ema[50] === null ? "N/A" : formatCurrency(snapshot.ema[50]!, currency)}
        />
        <Metric
          label="EMA 200"
          value={snapshot.ema[200] === null ? "N/A" : formatCurrency(snapshot.ema[200]!, currency)}
        />
        <Metric label="ATR % of price" value={snapshot.atrPct === null ? "N/A" : `${snapshot.atrPct.toFixed(2)}%`} />
        <Metric
          label="Avg volume (20)"
          value={snapshot.averageVolume === null ? "N/A" : formatCompact(snapshot.averageVolume)}
        />
      </dl>

      {snapshot.components.length > 0 && (
        <details className="rounded-lg border px-3 py-2">
          <summary className="cursor-pointer text-sm font-medium">
            How the score of {snapshot.score} was reached
          </summary>
          <ul className="mt-2 space-y-1.5 text-sm">
            {snapshot.components.map((component) => (
              <li key={component.key} className="flex items-start justify-between gap-3">
                <span className="text-muted-foreground min-w-0 flex-1">
                  <span className="text-foreground font-medium">{component.label}</span> ·{" "}
                  {component.reason}
                </span>
                <span className="tabular shrink-0 font-medium">
                  {component.points}/{component.max}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {snapshot.signals.length > 0 && (
        <div>
          <p className="text-muted-foreground mb-1.5 text-xs">Current conditions</p>
          <ul className="flex flex-wrap gap-1.5">
            {snapshot.signals.map((signal) => (
              <li
                key={signal}
                className="bg-muted/60 text-muted-foreground rounded-md px-2 py-1 text-xs"
              >
                {SIGNAL_LABELS[signal]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {snapshot.dataIssues.length > 0 && (
        <p className="text-muted-foreground text-xs">
          Data quality: {snapshot.dataIssues.join(", ")} in the source series. Affected bars were
          excluded before calculating.
        </p>
      )}

      <p className="text-muted-foreground text-xs">
        Technical indicators are analytical tools describing past price and volume. They do not
        predict future performance and are not investment advice.
      </p>
    </div>
  )
}
