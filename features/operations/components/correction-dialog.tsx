"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MarketSelect } from "@/components/market-select"
import { toMarket, type MarketId } from "@/domain/market"
import { apiFetch } from "@/lib/api-client"
import { formatTime } from "@/lib/format"
import type { FinancialAuditRow, TransactionRow } from "@/types/database"
import { useAppLocale } from "@/lib/i18n/locale"
import { useTranslations } from "next-intl"

/**
 * Correcting a transaction, with the reason kept.
 *
 * The difference from Edit is one field and one guarantee. **Both are audited** — a database
 * trigger writes the before and after of every change, and no route can opt out of it — but only a
 * correction carries *why*, because only a correction is being made deliberately in response to
 * something the user discovered.
 *
 * The history below is read straight from that trail. It is the same record an auditor would read,
 * and nothing in the application can edit or delete it.
 */

const OPERATION_LABELS: Record<string, string> = {
  INSERT: "Recorded",
  UPDATE: "Changed",
  DELETE: "Deleted",
}

function changedFields(event: FinancialAuditRow): string[] {
  if (!event.before || !event.after) return []
  // Only the fields a user recognises. `updated_at` changes on every write and says nothing.
  const interesting = ["symbol", "market", "side", "trade_date", "quantity", "price", "fee", "notes"]
  return interesting.filter((key) => String(event.before?.[key]) !== String(event.after?.[key]))
}

export function CorrectionDialog({
  open,
  onOpenChange,
  transaction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  transaction: TransactionRow
}) {
  const to = useTranslations("operations")
  const tEnum = useTranslations("enums")
  const tc = useTranslations("common")
  const locale = useAppLocale()
  const router = useRouter()
  const [symbol, setSymbol] = useState(transaction.symbol)
  const [market, setMarket] = useState<MarketId>(toMarket(transaction.market))
  const [side, setSide] = useState(transaction.side)
  const [tradeDate, setTradeDate] = useState(transaction.trade_date.slice(0, 10))
  const [quantity, setQuantity] = useState(String(transaction.quantity))
  const [price, setPrice] = useState(String(transaction.price))
  const [fee, setFee] = useState(String(transaction.fee))
  const [reason, setReason] = useState("")

  /*
   * There is no effect resetting these when the transaction changes, deliberately: the caller
   * mounts this per transaction and unmounts it on close, so every open starts from the stored row.
   * Synchronising props into state inside an effect causes a cascading render and is the pattern
   * React's own lint rejects.
   */

  const history = useQuery({
    queryKey: ["audit", transaction.id],
    // Only when the dialog is open: an audit read per row would be a read per row.
    enabled: open,
    queryFn: () =>
      apiFetch<{ events: FinancialAuditRow[] }>(`/api/audit?entityId=${transaction.id}`),
  })

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/transactions/${transaction.id}/correction`, {
        method: "POST",
        body: JSON.stringify({
          symbol,
          market,
          side,
          tradeDate,
          quantity: Number(quantity),
          price: Number(price),
          fee: Number(fee),
          notes: transaction.notes,
          reason,
        }),
      }),
    onSuccess: () => {
      toast.success(to("correction.corrected"))
      onOpenChange(false)
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const canSubmit = reason.trim().length >= 3 && Number(quantity) > 0 && Number(price) >= 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (canSubmit) mutation.mutate()
          }}
          noValidate
        >
          <DialogHeader>
            <DialogTitle>{to("correction.title")}</DialogTitle>
            <DialogDescription>{to("correction.hint")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="corr-symbol">{to("correction.symbol")}</Label>
                <Input
                  id="corr-symbol"
                  value={symbol}
                  onChange={(event) => setSymbol(event.target.value.toUpperCase())}
                  maxLength={20}
                />
              </div>
              <MarketSelect id="corr-market" value={market} onChange={setMarket} />
              <div className="space-y-2">
                <Label htmlFor="corr-side">{to("correction.side")}</Label>
                <select
                  id="corr-side"
                  value={side}
                  onChange={(event) => setSide(event.target.value as typeof side)}
                  className="border-input bg-background focus-visible:ring-ring h-11 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                >
                  <option value="buy">{tEnum("transactionSide.buy")}</option>
                  <option value="sell">{tEnum("transactionSide.sell")}</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="corr-date">{to("correction.tradeDate")}</Label>
                <Input
                  id="corr-date"
                  type="date"
                  value={tradeDate}
                  onChange={(event) => setTradeDate(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="corr-quantity">{to("correction.quantity")}</Label>
                <Input
                  id="corr-quantity"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  className="tabular"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="corr-price">{to("correction.price")}</Label>
                <Input
                  id="corr-price"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  className="tabular"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="corr-fee">{to("correction.fee")}</Label>
                <Input
                  id="corr-fee"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  className="tabular"
                  value={fee}
                  onChange={(event) => setFee(event.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="corr-reason">{to("correction.why")}</Label>
              <Input
                id="corr-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={to("correction.placeholder")}
                maxLength={500}
                required
                aria-describedby="corr-reason-help"
              />
              <p id="corr-reason-help" className="text-muted-foreground text-xs">
                Kept with the before-and-after in the audit trail. Required — a financial change
                nobody can explain is what the trail exists to prevent.
              </p>
            </div>

            <div className="space-y-2 border-t pt-3">
              <p className="text-sm font-medium">{to("correction.history")}</p>
              {history.isPending ? (
                <p className="text-muted-foreground text-xs">{tc("state.loading")}</p>
              ) : history.isError ? (
                <p className="text-muted-foreground text-xs">{to("correction.historyFailed")}</p>
              ) : (history.data?.events.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-xs">{to("correction.noChanges")}</p>
              ) : (
                <ul className="text-muted-foreground space-y-1.5 text-xs">
                  {history.data?.events.map((event) => (
                    <li key={event.id} className="flex flex-wrap gap-x-2">
                      <span className="text-foreground font-medium">
                        {OPERATION_LABELS[event.operation] ?? event.operation}
                      </span>
                      <span>{formatTime(event.occurred_at, locale)}</span>
                      {changedFields(event).length > 0 ? (
                        <span>· {changedFields(event).join(", ")}</span>
                      ) : null}
                      {event.reason ? <span className="w-full italic">“{event.reason}”</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>{tc("actions.cancel")}</Button>
            <Button type="submit" disabled={!canSubmit || mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Save correction
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
