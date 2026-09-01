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
import { cn } from "@/lib/utils"
import type { CashTransactionRow } from "@/types/database"
import { cashInputSchema, type CashFormValues, type CashInput } from "../schema"

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
              Deposits and withdrawals are capital flows, not returns — they change your balance
              without changing your performance.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Cash movement type">
              {(["deposit", "withdrawal"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={kind === value}
                  onClick={() => form.setValue("kind", value)}
                  className={cn(
                    "h-11 rounded-lg border text-sm font-medium capitalize transition-colors",
                    kind === value
                      ? value === "deposit"
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
                <Label htmlFor="cash-amount">Amount</Label>
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
                <Label htmlFor="cash-date">Date</Label>
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
              <Label htmlFor="cash-notes">
                Notes <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="cash-notes" placeholder="Monthly contribution" {...form.register("notes")} />
            </div>

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
              {isEdit ? "Save changes" : "Record"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
