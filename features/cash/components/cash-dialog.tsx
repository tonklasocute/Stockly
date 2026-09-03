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
import { CASH_FLOW_DIRECTION, CASH_FLOW_KINDS } from "@/domain/cash"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import type { CashTransactionRow } from "@/types/database"
import { cashInputSchema, type CashFormValues, type CashInput } from "../schema"
import { useTranslations } from "next-intl"

const today = () => new Date().toISOString().slice(0, 10)

export function CashDialog({
  open,
  onOpenChange,
  portfolioId,
  transaction,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolioId: string
  transaction?: CashTransactionRow
}) {
  const tEnum = useTranslations("enums")
  const t = useTranslations("cash")
  const tc = useTranslations("common")
  const router = useRouter()
  const isEdit = Boolean(transaction)

  const form = useForm<CashFormValues, unknown, CashInput>({
    resolver: zodResolver(cashInputSchema),
    defaultValues: { portfolioId, kind: "deposit", amount: 0, occurredOn: today(), notes: "" },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      portfolioId,
      kind: transaction?.kind ?? "deposit",
      amount: transaction?.amount ?? 0,
      occurredOn: transaction?.occurred_on.slice(0, 10) ?? today(),
      notes: transaction?.notes ?? "",
    })
  }, [open, transaction, portfolioId, form])

  const mutation = useMutation({
    mutationFn: (values: CashInput) =>
      apiFetch<CashTransactionRow>(isEdit ? `/api/cash/${transaction!.id}` : "/api/cash", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      toast.success(isEdit ? "Cash transaction updated." : "Cash transaction recorded.")
      onOpenChange(false)
      router.refresh()
    },
    onError: (error: Error) => form.setError("root", { message: error.message }),
  })

  const kind = form.watch("kind")
  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit cash transaction" : "Record cash"}</DialogTitle>
            <DialogDescription>
              Deposits, withdrawals and transfers are capital flows, not returns — they change your
              balance without changing your performance. Fees, tax and interest are the opposite:
              they are part of how the portfolio did, and never contributed capital.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            {/*
              * One control for one field. The sign carries the direction so colour is never the
              * only thing saying which way a movement goes, and every target stays at h-11 so it
              * is still a thumb target on a phone.
              */}
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-3"
              role="radiogroup"
              aria-label={t("type")}
            >
              {CASH_FLOW_KINDS.map((value) => {
                const inflow = CASH_FLOW_DIRECTION[value] === 1
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={kind === value}
                    onClick={() => form.setValue("kind", value)}
                    className={cn(
                      "focus-visible:ring-ring flex h-11 items-center justify-center gap-1 rounded-lg border px-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:outline-none",
                      kind === value
                        ? inflow
                          ? "border-gain/40 bg-gain/10 text-gain"
                          : "border-loss/40 bg-loss/10 text-loss"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <span aria-hidden>{inflow ? "+" : "−"}</span>
                    {tEnum(`cashFlow.${value}`)}
                  </button>
                )
              })}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="cash-amount">{t("amount")}</Label>
                <Input
                  id="cash-amount"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  className="tabular"
                  aria-invalid={!!errors.amount}
                  {...form.register("amount")}
                />
                {errors.amount && <p className="text-destructive text-sm">{errors.amount.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="cash-date">{t("date")}</Label>
                <Input
                  id="cash-date"
                  type="date"
                  max={today()}
                  aria-invalid={!!errors.occurredOn}
                  {...form.register("occurredOn")}
                />
                {errors.occurredOn && (
                  <p className="text-destructive text-sm">{errors.occurredOn.message}</p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cash-notes">{t("notes")}<span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="cash-notes" placeholder={t("monthlyContribution")} {...form.register("notes")} />
            </div>

            {errors.root && <p className="text-destructive text-sm">{errors.root.message}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              className="max-sm:h-11"
              onClick={() => onOpenChange(false)}
            >{tc("actions.cancel")}</Button>
            <Button type="submit" className="max-sm:h-11" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
