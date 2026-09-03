"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { AlertTriangle, Check, CircleHelp, Loader2, Minus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { MarketBadge } from "@/components/market-badge"
import { CASH_CAUSES, POSITION_CAUSES } from "@/domain/reconciliation"
import { currencyOf, toMarket } from "@/domain/market"
import { apiFetch } from "@/lib/api-client"
import { formatOptionalCurrency, formatOptionalPercent, formatQuantity } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ReconciliationItemRow } from "@/types/database"
import { useTranslations } from "next-intl"

/**
 * The findings from one run.
 *
 * Two rules shape every line of this component.
 *
 * **Status is never colour alone.** Each row carries an icon with a text label beside it, so it
 * reads correctly in greyscale and to a screen reader — the same rule the rest of Stockly applies
 * to gains and losses.
 *
 * **A missing figure is "N/A".** A statement that reported no average cost has no average cost; a
 * side that has no position at all shows nothing rather than a zero. The formatters do this for
 * money and percentages, and the quantity cells below do it explicitly.
 */

const STATUS_LABELS: Record<string, string> = {
  MATCHED: "Matched",
  QUANTITY_DIFFERS: "Quantity differs",
  COST_DIFFERS: "Average cost differs",
  MISSING_IN_STOCKLY: "Not in Stockly",
  MISSING_IN_BROKER: "Not on the statement",
  CURRENCY_MISMATCH: "Currency differs",
  DIFFERS: "Balance differs",
}

const CAUSES: Record<string, string> = { ...POSITION_CAUSES, ...CASH_CAUSES }

function StatusPill({ status }: { status: string }) {
  const matched = status === "MATCHED"
  const Icon = matched ? Check : status.startsWith("MISSING") ? CircleHelp : AlertTriangle
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium",
        matched ? "border-gain/40 text-gain" : "border-amber-500/40 text-amber-600 dark:text-amber-400",
      )}
    >
      <Icon className="size-3" aria-hidden />
      {STATUS_LABELS[status] ?? status}
    </span>
  )
}

/** A quantity that may not exist on one side. Never rendered as 0. */
function Quantity({ value }: { value: unknown }) {
  return <span className="tabular">{typeof value === "number" ? formatQuantity(value) : "N/A"}</span>
}

function num(detail: Record<string, unknown>, key: string): number | null {
  const value = detail[key]
  return typeof value === "number" ? value : null
}

function FindingRow({ item, runId }: { item: ReconciliationItemRow; runId: string }) {
  const to = useTranslations("operations")
  const router = useRouter()
  const detail = item.detail ?? {}
  const causes = Array.isArray(detail.causes) ? (detail.causes as string[]) : []
  const [resolved, setResolved] = useState(item.resolved_at !== null)
  const currency = item.currency ?? "USD"

  const mutation = useMutation({
    mutationFn: (resolution: "ADJUSTED" | "IGNORED" | "EXPLAINED") =>
      apiFetch(`/api/reconciliation/${runId}/items`, {
        method: "PATCH",
        body: JSON.stringify({ itemId: item.id, resolution }),
      }),
    onSuccess: () => {
      setResolved(true)
      toast.success(to("findings.marked"))
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <li className={cn("space-y-2 py-3", resolved && "opacity-60")}>
      <div className="flex flex-wrap items-center gap-2">
        {item.symbol ? (
          <span className="font-medium">{item.symbol}</span>
        ) : (
          <span className="font-medium">{item.currency ?? "Cash"}</span>
        )}
        {item.market ? (
          <MarketBadge market={toMarket(item.market)} currency={currencyOf(toMarket(item.market))} />
        ) : null}
        <StatusPill status={item.status} />
        {resolved ? (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <Check className="size-3" aria-hidden />{to("findings.reviewed")}</span>
        ) : null}
      </div>

      {item.scope === "POSITIONS" ? (
        <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
          <div>
            <dt>{to("findings.statement")}</dt>
            <dd className="text-foreground">
              <Quantity value={detail.brokerQuantity} />
            </dd>
          </div>
          <div>
            <dt>Stockly</dt>
            <dd className="text-foreground">
              <Quantity value={detail.stocklyQuantity} />
            </dd>
          </div>
          <div>
            <dt>{to("findings.statementCost")}</dt>
            <dd className="text-foreground tabular">
              {formatOptionalCurrency(num(detail, "brokerAverageCost"), currency)}
            </dd>
          </div>
          <div>
            <dt>{to("findings.difference")}</dt>
            <dd className="text-foreground tabular">
              {formatOptionalPercent(num(detail, "costDifferencePct"))}
            </dd>
          </div>
        </dl>
      ) : (
        <dl className="text-muted-foreground grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
          <div>
            <dt>{to("findings.statement")}</dt>
            <dd className="text-foreground tabular">
              {formatOptionalCurrency(num(detail, "brokerBalance"), currency)}
            </dd>
          </div>
          <div>
            <dt>Stockly</dt>
            <dd className="text-foreground tabular">
              {formatOptionalCurrency(num(detail, "stocklyBalance"), currency)}
            </dd>
          </div>
          <div>
            <dt>{to("findings.difference")}</dt>
            <dd className="text-foreground tabular">
              {formatOptionalCurrency(num(detail, "difference"), currency)}
            </dd>
          </div>
        </dl>
      )}

      {causes.length > 0 ? (
        <div className="text-muted-foreground space-y-1 text-xs">
          <p className="font-medium">{to("findings.causes")}</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {causes.map((cause) => (
              <li key={cause}>{CAUSES[cause] ?? cause}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {!resolved && item.status !== "MATCHED" ? (
        <div className="flex flex-wrap gap-2">
          {(["EXPLAINED", "ADJUSTED", "IGNORED"] as const).map((resolution) => (
            <Button
              key={resolution}
              type="button"
              variant="outline"
              size="sm"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(resolution)}
            >
              {mutation.isPending ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
              {resolution === "EXPLAINED"
                ? "I understand this"
                : resolution === "ADJUSTED"
                  ? "I have corrected it"
                  : "Ignore"}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  )
}

export function Findings({ items, runId }: { items: ReconciliationItemRow[]; runId: string }) {
  const to = useTranslations("operations")
  if (items.length === 0) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 py-6 text-sm">
        <Minus className="size-4" aria-hidden />{to("findings.nothingCompared")}</p>
    )
  }

  return <ul className="divide-y">{items.map((item) => <FindingRow key={item.id} item={item} runId={runId} />)}</ul>
}
