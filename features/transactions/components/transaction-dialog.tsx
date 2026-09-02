"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
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
import { currencyOf, toMarket } from "@/domain/market"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import { formatCurrency } from "@/lib/format"
import type { TransactionRow } from "@/types/database"
import {
  transactionInputSchema,
  type TransactionFormValues,
  type TransactionInput,
} from "../schema"

function today() {
  return new Date().toISOString().slice(0, 10)
}

export function TransactionDialog({
  open,
  onOpenChange,
  portfolioId,
  transaction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolioId: string
  /** Present when editing an existing row. */
  transaction?: TransactionRow
}) {
  const router = useRouter()
  const isEdit = Boolean(transaction)

  const form = useForm<TransactionFormValues, unknown, TransactionInput>({
    resolver: zodResolver(transactionInputSchema),
    defaultValues: {
      portfolioId,
      symbol: "",
      market: "US",
      side: "buy",
      tradeDate: today(),
      quantity: 0,
      price: 0,
      fee: 0,
      notes: "",
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      portfolioId,
      symbol: transaction?.symbol ?? "",
      market: toMarket(transaction?.market),
      side: transaction?.side ?? "buy",
      tradeDate: transaction?.trade_date.slice(0, 10) ?? today(),
      quantity: transaction?.quantity ?? 0,
      price: transaction?.price ?? 0,
      fee: transaction?.fee ?? 0,
      notes: transaction?.notes ?? "",
    })
  }, [open, transaction, portfolioId, form])

  const mutation = useMutation({
    mutationFn: (values: TransactionInput) =>
      apiFetch<TransactionRow>(
        isEdit ? `/api/transactions/${transaction!.id}` : "/api/transactions",
        { method: isEdit ? "PATCH" : "POST", body: JSON.stringify(values) },
      ),
    onSuccess: () => {
      toast.success(isEdit ? "Transaction updated." : "Transaction added.")
      onOpenChange(false)
      // Holdings are derived, so a refresh is all it takes for every page to agree.
      router.refresh()
    },
    onError: (error: Error) => form.setError("root", { message: error.message }),
  })

  const side = form.watch("side")
  const market = toMarket(form.watch("market"))
  /**
   * Price, fee and total are in the **instrument's** currency, not the portfolio's. A trade on SET
   * happens in baht regardless of what the portfolio is kept in, and labelling the field with the
   * portfolio's currency would invite the user to type the wrong number.
   */
  const tradeCurrency = currencyOf(market)
  const quantity = Number(form.watch("quantity")) || 0
  const price = Number(form.watch("price")) || 0
  const fee = Number(form.watch("fee")) || 0
  const total = side === "buy" ? quantity * price + fee : quantity * price - fee
  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit transaction" : "Add transaction"}</DialogTitle>
            <DialogDescription>
              Holdings and profit and loss are recalculated from your transactions.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Transaction type">
              {(["buy", "sell"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={side === value}
                  onClick={() => form.setValue("side", value)}
                  className={cn(
                    "h-10 rounded-lg border text-sm font-medium capitalize transition-colors",
                    side === value
                      ? value === "buy"
                        ? "border-gain/40 bg-gain/10 text-gain"
                        : "border-loss/40 bg-loss/10 text-loss"
                      : "text-muted-foreground hover:bg-accent",
                  )}
                >
                  {value}
                </button>
              ))}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="symbol">Symbol</Label>
                <Input
                  id="symbol"
                  placeholder="NVDA"
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="uppercase"
                  aria-invalid={!!errors.symbol}
                  {...form.register("symbol")}
                />
                {errors.symbol && <p className="text-destructive text-sm">{errors.symbol.message}</p>}
              </div>

              <MarketSelect
                id="transaction-market"
                value={market}
                onChange={(next) => form.setValue("market", next)}
                // The market fixes the currency of every stored amount, so changing it on an
                // existing row would silently reinterpret a price that was already recorded.
                disabled={isEdit}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="tradeDate">Date</Label>
                {/* Native date input: correct on every mobile keyboard, no picker dependency. */}
                <Input
                  id="tradeDate"
                  type="date"
                  max={today()}
                  aria-invalid={!!errors.tradeDate}
                  {...form.register("tradeDate")}
                />
                {errors.tradeDate && (
                  <p className="text-destructive text-sm">{errors.tradeDate.message}</p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  { name: "quantity", label: "Quantity", step: "any", min: 0 },
                  { name: "price", label: `Price (${tradeCurrency})`, step: "any", min: 0 },
                  { name: "fee", label: `Fee (${tradeCurrency})`, step: "any", min: 0 },
                ] as const
              ).map((field) => (
                <div key={field.name} className="space-y-2">
                  <Label htmlFor={field.name}>{field.label}</Label>
                  <Input
                    id={field.name}
                    type="number"
                    inputMode="decimal"
                    step={field.step}
                    min={field.min}
                    className="tabular"
                    aria-invalid={!!errors[field.name]}
                    {...form.register(field.name)}
                  />
                  {errors[field.name] && (
                    <p className="text-destructive text-sm">{errors[field.name]?.message}</p>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">
                Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="notes" placeholder="Why you made this trade" {...form.register("notes")} />
            </div>

            <div className="bg-muted/50 flex items-center justify-between rounded-lg px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">
                {side === "buy" ? "Total cost" : "Net proceeds"}
              </span>
              <span className="tabular font-semibold">
                {formatCurrency(total, tradeCurrency)}
              </span>
            </div>

            {errors.root && <p className="text-destructive text-sm">{errors.root.message}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" className="max-sm:h-11" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="max-sm:h-11" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Add transaction"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
