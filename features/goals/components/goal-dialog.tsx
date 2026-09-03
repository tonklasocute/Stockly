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
import { GOAL_DEFINITIONS, GOAL_TYPES, type GoalType } from "@/domain/goals"
import { CURRENCIES, type Currency } from "@/domain/market"
import { apiFetch } from "@/lib/api-client"
import type { PortfolioGoalRow } from "@/types/database"
import { goalInputSchema, type GoalFormValues, type GoalInput } from "../schema"
import { useTranslations } from "next-intl"

export function GoalDialog({
  open,
  onOpenChange,
  portfolioId,
  baseCurrency,
  goal,
  takenTypes = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolioId: string
  baseCurrency: Currency
  /** Present when editing. A goal's type cannot change — see the API route for why. */
  goal?: PortfolioGoalRow
  /** Types this portfolio already has, so the picker cannot create a duplicate it would 409 on. */
  takenTypes?: readonly GoalType[]
}) {
  const t = useTranslations("goals")
  const tc = useTranslations("common")
  const router = useRouter()
  const isEdit = Boolean(goal)

  const form = useForm<GoalFormValues, unknown, GoalInput>({
    resolver: zodResolver(goalInputSchema),
    defaultValues: { portfolioId, type: "PORTFOLIO_VALUE", targetValue: 0, currency: baseCurrency },
  })

  useEffect(() => {
    if (!open) return
    const available = GOAL_TYPES.find((t) => !takenTypes.includes(t)) ?? "PORTFOLIO_VALUE"
    const type = (goal?.type ?? available) as GoalType
    form.reset({
      portfolioId,
      type,
      targetValue: goal ? Number(goal.target_value) : 0,
      // A percentage target must have no currency at all; the schema and the database both refuse one.
      currency: type === "TOTAL_RETURN" ? undefined : ((goal?.currency as Currency) ?? baseCurrency),
      targetDate: goal?.target_date?.slice(0, 10) ?? "",
      note: goal?.note ?? "",
    })
  }, [open, goal, portfolioId, baseCurrency, takenTypes, form])

  const type = form.watch("type") as GoalType
  const isPercent = GOAL_DEFINITIONS[type].unit === "percent"
  const errors = form.formState.errors

  const mutation = useMutation({
    mutationFn: (values: GoalInput) =>
      apiFetch<PortfolioGoalRow>(isEdit ? `/api/goals/${goal!.id}` : "/api/goals", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(
          isEdit
            ? {
                targetValue: values.targetValue,
                currency: values.currency ?? null,
                targetDate: values.targetDate ?? null,
                note: values.note ?? null,
              }
            : values,
        ),
      }),
    onSuccess: () => {
      toast.success(isEdit ? "Goal updated." : "Goal set.")
      onOpenChange(false)
      router.refresh()
    },
    onError: (error: Error) => form.setError("root", { message: error.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit goal" : "Set a goal"}</DialogTitle>
            <DialogDescription>
              Progress is measured from your transactions and market data, so a goal never changes a
              figure — it only gives one something to be measured against.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="goal-type">{t("measure")}</Label>
              <Select
                value={type}
                onValueChange={(value) => {
                  const next = value as GoalType
                  form.setValue("type", next)
                  // Keeping a currency on a return target would be rejected by the schema, so the
                  // field is cleared as the type changes rather than at submit time.
                  form.setValue(
                    "currency",
                    GOAL_DEFINITIONS[next].unit === "percent" ? undefined : baseCurrency,
                  )
                }}
                disabled={isEdit}
              >
                <SelectTrigger id="goal-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GOAL_TYPES.filter((t) => t === type || !takenTypes.includes(t)).map((t) => (
                    <SelectItem key={t} value={t}>
                      {GOAL_DEFINITIONS[t].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">{GOAL_DEFINITIONS[type].measures}</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="goal-target">Target {isPercent ? "(%)" : ""}</Label>
                <Input
                  id="goal-target"
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  className="tabular"
                  aria-invalid={!!errors.targetValue}
                  {...form.register("targetValue")}
                />
                {errors.targetValue && (
                  <p className="text-destructive text-sm">{errors.targetValue.message}</p>
                )}
              </div>

              {!isPercent && (
                <div className="space-y-2">
                  <Label htmlFor="goal-currency">{t("currency")}</Label>
                  <Select
                    value={(form.watch("currency") as string) ?? baseCurrency}
                    onValueChange={(value) => form.setValue("currency", value as Currency)}
                  >
                    <SelectTrigger id="goal-currency" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((currency) => (
                        <SelectItem key={currency} value={currency}>
                          {currency}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="goal-date">{t("targetDate")}<span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="goal-date" type="date" {...form.register("targetDate")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="goal-note">{t("note")}<span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Input id="goal-note" placeholder={t("why")} {...form.register("note")} />
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
              {isEdit ? "Save changes" : "Set goal"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
