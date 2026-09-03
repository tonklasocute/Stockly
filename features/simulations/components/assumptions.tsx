"use client"

import { Metric } from "@/components/metric"
import { cn } from "@/lib/utils"
import { useTranslations } from "next-intl"

/**
 * The label that separates what happened from what was calculated.
 *
 * Phase 11's most important piece of UI is a word. Every projected figure carries one of these, so
 * a number a user reads is never ambiguous about which kind of number it is.
 */
export function DataLabel({
  kind,
  className,
}: {
  kind: "ACTUAL" | "PROJECTED" | "SCENARIO" | "ASSUMPTION"
  className?: string
}) {
  const tone =
    kind === "ACTUAL"
      ? "bg-muted text-foreground"
      : "bg-chart-1/10 text-muted-foreground ring-1 ring-inset ring-border"

  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
        tone,
        className,
      )}
    >
      {kind}
    </span>
  )
}

export type Assumption = { label: string; value: string; hint?: string }

/**
 * Every assumption behind a result, listed beside it.
 *
 * Not collapsible and not hidden: a projected figure read without the assumptions that produced it
 * is indistinguishable from a forecast, and the assumptions are the only thing that makes it
 * checkable. The disclaimer sits in the same box for the same reason.
 */
export function AssumptionPanel({
  assumptions,
  method,
  className,
}: {
  assumptions: Assumption[]
  /** The engine's own description of what it did, printed verbatim rather than paraphrased. */
  method: string
  className?: string
}) {
  const t = useTranslations("simulations")
  return (
    <div className={cn("bg-muted/40 space-y-3 rounded-xl border p-4", className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{t("assumptions.title")}</h3>
        <DataLabel kind="ASSUMPTION" />
      </div>

      <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        {assumptions.map((assumption) => (
          <Metric
            key={assumption.label}
            label={assumption.label}
            value={assumption.value}
            hint={assumption.hint}
          />
        ))}
      </dl>

      <p className="text-muted-foreground border-t pt-3 text-xs">{method}</p>

      <p className="text-muted-foreground text-xs">
        <strong className="text-foreground font-medium">{t("assumptions.notPredictions")}</strong> Scenario
        results are arithmetic on the assumptions above, which you chose. They are not forecasts, not
        guarantees and not investment advice. Real returns vary year to year and may differ
        substantially — including being negative.
      </p>
    </div>
  )
}
