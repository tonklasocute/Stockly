"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { ArrowRightLeft, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MarketSelect } from "@/components/market-select"
import { currencyOf, type MarketId } from "@/domain/market"
import { apiFetch } from "@/lib/api-client"
import { formatCurrency, formatQuantity } from "@/lib/format"
import type { Position } from "@/domain/types"
import type { PortfolioRow } from "@/types/database"
import { useTranslations } from "next-intl"

/**
 * Moving holdings between two of your own portfolios.
 *
 * **A transfer re-parents the transactions.** It is not a sale and a repurchase, and the panel says
 * so where the user will read it: a synthesised sell-and-buy pair would book a realized profit or
 * loss nobody made, and nothing downstream could tell it apart from one that was earned.
 *
 * The preview and the apply are one request with one flag. The preview writes nothing at all — no
 * pending transfer, no staging row — so abandoning it leaves nothing behind.
 */

type Preview = {
  positions: Position[]
  transactionCount: number
  adjustmentCount: number
  realizedPnl: 0
}

export function TransferPanel({
  portfolios,
  activeId,
}: {
  portfolios: Pick<PortfolioRow, "id" | "name">[]
  activeId: string
}) {
  const to = useTranslations("operations")
  const router = useRouter()
  const others = portfolios.filter((p) => p.id !== activeId)
  const [toPortfolioId, setToPortfolioId] = useState(others[0]?.id ?? "")
  const [symbol, setSymbol] = useState("")
  const [market, setMarket] = useState<MarketId>("US")
  const [reason, setReason] = useState("")
  const [preview, setPreview] = useState<Preview | null>(null)

  const scoped = symbol.trim().length > 0

  const body = (apply: boolean) => ({
    fromPortfolioId: activeId,
    toPortfolioId,
    symbol: scoped ? symbol.toUpperCase() : null,
    market: scoped ? market : null,
    reason: reason.trim(),
    apply,
  })

  const run = useMutation({
    mutationFn: (apply: boolean) =>
      apiFetch<{ preview: Preview; applied: boolean; moved?: number }>("/api/transfers", {
        method: "POST",
        body: JSON.stringify(body(apply)),
      }),
    onSuccess: (result) => {
      if (result.applied) {
        setPreview(null)
        setSymbol("")
        toast.success(
          `Moved ${result.moved ?? 0} transaction${result.moved === 1 ? "" : "s"}. No profit or loss was created.`,
        )
        router.refresh()
      } else {
        setPreview(result.preview)
      }
    },
    onError: (error: Error) => {
      setPreview(null)
      toast.error(error.message)
    },
  })

  if (others.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">{to("transferForm.needsSecond")}</p>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tr-to">{to("transferForm.moveInto")}</Label>
          <select
            id="tr-to"
            value={toPortfolioId}
            onChange={(event) => {
              setToPortfolioId(event.target.value)
              setPreview(null)
            }}
            className="border-input bg-background focus-visible:ring-ring h-11 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
          >
            {others.map((portfolio) => (
              <option key={portfolio.id} value={portfolio.id}>
                {portfolio.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="tr-symbol">{to("transferForm.symbol")}</Label>
          <Input
            id="tr-symbol"
            value={symbol}
            onChange={(event) => {
              setSymbol(event.target.value.toUpperCase())
              setPreview(null)
            }}
            placeholder={to("transferForm.leaveBlank")}
            maxLength={20}
            aria-describedby="tr-symbol-help"
          />
          <p id="tr-symbol-help" className="text-muted-foreground text-xs">
            An instrument moves with its whole history or not at all — splitting one average cost
            across two portfolios would leave both wrong.
          </p>
        </div>
        {scoped ? (
          <MarketSelect
            id="tr-market"
            value={market}
            onChange={(next) => {
              setMarket(next)
              setPreview(null)
            }}
          />
        ) : null}
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="tr-reason">{to("transferForm.why")}</Label>
          <Input
            id="tr-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={to("transferForm.reasonPlaceholder")}
            maxLength={500}
          />
        </div>
      </div>

      {preview ? (
        <div className="bg-muted/40 space-y-2 rounded-lg border p-3 text-sm">
          <p className="font-medium">
            {preview.transactionCount} transaction{preview.transactionCount === 1 ? "" : "s"} would
            move
            {preview.adjustmentCount > 0
              ? `, with ${preview.adjustmentCount} recorded split${preview.adjustmentCount === 1 ? "" : "s"}`
              : ""}
          </p>
          {preview.positions.length > 0 ? (
            <ul className="text-muted-foreground space-y-0.5 text-xs">
              {preview.positions.map((position) => (
                <li key={`${position.market}:${position.symbol}`} className="tabular">
                  {position.symbol} · {formatQuantity(position.quantity)} shares at{" "}
                  {formatCurrency(position.averageCost, currencyOf(position.market))} average cost
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-muted-foreground text-xs">
            Quantity, cost basis and acquisition dates are preserved — the rows are the same rows.
            No profit or loss is realized, because nothing is sold.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={run.isPending || reason.trim().length < 3}
          onClick={() => run.mutate(false)}
        >
          {run.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          Preview
        </Button>
        <Button type="button" disabled={!preview || run.isPending} onClick={() => run.mutate(true)}>
          <ArrowRightLeft className="size-4" aria-hidden />{to("transferForm.move")}</Button>
        {reason.trim().length < 3 ? (
          <p className="text-muted-foreground self-center text-xs">{to("transferForm.needsReason")}</p>
        ) : null}
      </div>
    </div>
  )
}
