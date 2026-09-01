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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  ALERT_TYPE_LABELS,
  PERCENT_ALERT_TYPES,
  SYMBOL_ALERT_TYPES,
  type AlertType,
} from "@/domain/alerts"
import { apiFetch } from "@/lib/api-client"
import type { AlertRow } from "@/types/database"
import { alertInputSchema, type AlertFormValues, type AlertInput } from "../schema"

/** Grouped so the list reads as three decisions, not eleven options. */
const TYPE_GROUPS: Array<{ label: string; types: AlertType[] }> = [
  { label: "Price", types: ["PRICE_ABOVE", "PRICE_BELOW"] },
  { label: "Daily move", types: ["PERCENT_CHANGE_ABOVE", "PERCENT_CHANGE_BELOW"] },
  {
    label: "Portfolio",
    types: [
      "PORTFOLIO_DAILY_CHANGE_ABOVE",
      "PORTFOLIO_DAILY_CHANGE_BELOW",
      "PORTFOLIO_TOTAL_RETURN_ABOVE",
      "PORTFOLIO_TOTAL_RETURN_BELOW",
      "POSITION_WEIGHT_ABOVE",
      "POSITION_WEIGHT_BELOW",
    ],
  },
  { label: "Dividend", types: ["DIVIDEND_RECEIVED"] },
]

const COOLDOWNS = [
  { value: "0", label: "No cooldown" },
  { value: "15", label: "15 minutes" },
  { value: "60", label: "1 hour" },
  { value: "360", label: "6 hours" },
  { value: "1440", label: "1 day" },
]

export function AlertDialog({
  open,
  onOpenChange,
  portfolioId,
  defaultSymbol,
  defaultType,
  defaultTarget,
  alert,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolioId?: string
  defaultSymbol?: string
  defaultType?: AlertType
  defaultTarget?: number
  alert?: AlertRow
}) {
  const router = useRouter()
  const isEdit = Boolean(alert)

  const form = useForm<AlertFormValues, unknown, AlertInput>({
    resolver: zodResolver(alertInputSchema),
    defaultValues: {
      type: defaultType ?? "PRICE_ABOVE",
      symbol: defaultSymbol ?? "",
      portfolioId,
      targetValue: defaultTarget ?? 0,
      cooldownMinutes: 60,
      enabled: true,
    },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      type: (alert?.type ?? defaultType ?? "PRICE_ABOVE") as AlertType,
      symbol: alert?.symbol ?? defaultSymbol ?? "",
      portfolioId,
      targetValue: alert ? Number(alert.target_value) : (defaultTarget ?? 0),
      cooldownMinutes: alert?.cooldown_minutes ?? 60,
      enabled: alert?.enabled ?? true,
    })
  }, [open, alert, defaultSymbol, defaultType, defaultTarget, portfolioId, form])

  const mutation = useMutation({
    mutationFn: (values: AlertInput) =>
      apiFetch<AlertRow>(isEdit ? `/api/alerts/${alert!.id}` : "/api/alerts", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(
          isEdit
            ? {
                targetValue: values.targetValue,
                cooldownMinutes: values.cooldownMinutes,
                enabled: values.enabled,
              }
            : values,
        ),
      }),
    onSuccess: () => {
      toast.success(isEdit ? "Alert updated." : "Alert created.")
      onOpenChange(false)
      router.refresh()
    },
    onError: (error: Error) => form.setError("root", { message: error.message }),
  })

  const type = form.watch("type") as AlertType
  const needsSymbol = SYMBOL_ALERT_TYPES.includes(type)
  const isPercent = PERCENT_ALERT_TYPES.includes(type)
  const isDividend = type === "DIVIDEND_RECEIVED"
  const errors = form.formState.errors

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit alert" : "New alert"}</DialogTitle>
            <DialogDescription>
              Alerts are evaluated on the server every few minutes, so they fire whether or not
              Stockly is open.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="alert-type">Notify me when</Label>
              <Select
                value={type}
                onValueChange={(value) => form.setValue("type", (value as AlertType) ?? "PRICE_ABOVE")}
                disabled={isEdit}
              >
                <SelectTrigger id="alert-type" className="w-full">
                  <SelectValue>{(value) => ALERT_TYPE_LABELS[value as AlertType]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TYPE_GROUPS.map((group) =>
                    group.types.map((option) => (
                      <SelectItem key={option} value={option}>
                        {ALERT_TYPE_LABELS[option]}
                      </SelectItem>
                    )),
                  )}
                </SelectContent>
              </Select>
              {isEdit && (
                <p className="text-muted-foreground text-xs">
                  The condition cannot be changed. Delete this alert and create another instead.
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {needsSymbol && (
                <div className="space-y-2">
                  <Label htmlFor="alert-symbol">Stock</Label>
                  <Input
                    id="alert-symbol"
                    placeholder="NVDA"
                    autoCapitalize="characters"
                    autoComplete="off"
                    className="uppercase"
                    disabled={isEdit}
                    aria-invalid={!!errors.symbol}
                    {...form.register("symbol")}
                  />
                  {errors.symbol && <p className="text-destructive text-sm">{errors.symbol.message}</p>}
                </div>
              )}

              {!isDividend && (
                <div className="space-y-2">
                  <Label htmlFor="alert-target">{isPercent ? "Percent" : "Price"}</Label>
                  <div className="relative">
                    <Input
                      id="alert-target"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      className="tabular pr-8"
                      aria-invalid={!!errors.targetValue}
                      {...form.register("targetValue")}
                    />
                    <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm">
                      {isPercent ? "%" : "$"}
                    </span>
                  </div>
                  {errors.targetValue && (
                    <p className="text-destructive text-sm">{errors.targetValue.message}</p>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="alert-cooldown">Quiet period after it fires</Label>
              <Select
                value={String(form.watch("cooldownMinutes") ?? 60)}
                onValueChange={(value) => form.setValue("cooldownMinutes", Number(value ?? 60))}
              >
                <SelectTrigger id="alert-cooldown" className="w-full">
                  <SelectValue>
                    {(value) => COOLDOWNS.find((c) => c.value === String(value))?.label}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COOLDOWNS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                A price hovering at your target will not notify you repeatedly: the alert only fires
                again after the condition goes false and comes back.
              </p>
            </div>

            {errors.root && <p className="text-destructive text-sm">{errors.root.message}</p>}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create alert"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
