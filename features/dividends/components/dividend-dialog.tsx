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
import { apiFetch } from "@/lib/api-client"
import { formatCurrency } from "@/lib/format"
import type { DividendRow } from "@/types/database"
import {
  dividendInputSchema,
  type DividendFormValues,
  type DividendInput,
} from "../schema"

const today = () => new Date().toISOString().slice(0, 10)

export function DividendDialog({
  open,
  onOpenChange,
  portfolioId,
  currency,
  dividend,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolioId: string
  currency: string
  dividend?: DividendRow
}) {
  const router = useRouter()
  const isEdit = Boolean(dividend)

  const form = useForm<DividendFormValues, unknown, DividendInput>({
    resolver: zodResolver(dividendInputSchema),
    defaultValues: {
      portfolioId,
      symbol: "",
      paymentDate: today(),
      shares: 0,
      dividendPerShare: 0,
      tax: 0,
      fee: 0,
      notes: "",
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      portfolioId,
      symbol: dividend?.symbol ?? "",
      paymentDate: dividend?.payment_date.slice(0, 10) ?? today(),
      shares: dividend?.shares ?? 0,
      dividendPerShare: dividend?.dividend_per_share ?? 0,
      tax: dividend?.tax ?? 0,
      fee: dividend?.fee ?? 0,
      notes: dividend?.notes ?? "",
    })
  }, [open, dividend, portfolioId, form])

  const mutation = useMutation({
    mutationFn: (values: DividendInput) =>
      apiFetch<DividendRow>(isEdit ? `/api/dividends/${dividend!.id}` : "/api/dividends", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      toast.success(isEdit ? "Dividend updated." : "Dividend recorded.")
      onOpenChange(false)
      router.refresh()
    },
    onError: (error: Error) => form.setError("root", { message: error.message }),
  })

  const shares = Number(form.watch("shares")) || 0
  const perShare = Number(form.watch("dividendPerShare")) || 0
  const tax = Number(form.watch("tax")) || 0
  const fee = Number(form.watch("fee")) || 0
  const gross = shares * perShare
  const net = gross - tax - fee
  const errors = form.formState.errors

  const numberFields = [
    { name: "shares", label: "Shares" },
    { name: "dividendPerShare", label: "Dividend / share" },
    { name: "tax", label: "Tax" },
    { name: "fee", label: "Fee" },
  ] as const

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit dividend" : "Record dividend"}</DialogTitle>
            <DialogDescription>
              Net dividends are added to your cash balance and drive both yield figures.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dividend-symbol">Symbol</Label>
                <Input
                  id="dividend-symbol"
                  placeholder="AAPL"
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="uppercase"
                  aria-invalid={!!errors.symbol}
                  {...form.register("symbol")}
                />
                {errors.symbol && <p className="text-destructive text-sm">{errors.symbol.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="dividend-date">Payment date</Label>
                <Input
                  id="dividend-date"
                  type="date"
                  max={today()}
                  aria-invalid={!!errors.paymentDate}
                  {...form.register("paymentDate")}
                />
                {errors.paymentDate && (
                  <p className="text-destructive text-sm">{errors.paymentDate.message}</p>
                )}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-4">
              {numberFields.map((field) => (
                <div key={field.name} className="space-y-2">
                  <Label htmlFor={`dividend-${field.name}`}>{field.label}</Label>
                  <Input
                    id={`dividend-${field.name}`}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
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
              <Label htmlFor="dividend-notes">
                Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="dividend-notes" {...form.register("notes")} />
            </div>

            <dl className="bg-muted/50 grid grid-cols-2 gap-2 rounded-lg px-3 py-2.5 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Gross</dt>
                <dd className="tabular font-medium">{formatCurrency(gross, currency)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Net</dt>
                <dd className="tabular font-semibold">{formatCurrency(net, currency)}</dd>
              </div>
            </dl>

            {errors.root && <p className="text-destructive text-sm">{errors.root.message}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="max-sm:h-11"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="max-sm:h-11" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Record dividend"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
