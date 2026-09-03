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
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toMarket, type MarketId } from "@/domain/market"
import {
  MAX_CONVICTION,
  MIN_CONVICTION,
  THESIS_STATUSES,
  type ThesisStatus,
} from "@/domain/research"
import { apiFetch } from "@/lib/api-client"
import type { ThesisRow } from "@/types/database"
import { thesisInputSchema, type ThesisFormValues, type ThesisInput } from "../schema"
import { useTranslations } from "next-intl"

/**
 * The five prose fields, with the question each one is actually answering.
 *
 * `name` is the form field; `key` is the translation key for both its label and its placeholder —
 * one word, so a field cannot end up labelled as one thing and prompted as another.
 */
const FIELDS = [
  { name: "whyBought", key: "whyBought" },
  { name: "expectations", key: "expect" },
  { name: "catalysts", key: "catalysts" },
  { name: "risks", key: "risks" },
  { name: "invalidationCriteria", key: "changeMind" },
] as const

export function ThesisDialog({
  open,
  onOpenChange,
  portfolioId,
  symbol,
  market,
  thesis,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolioId: string
  symbol: string
  market: MarketId
  /** Present when editing. */
  thesis?: ThesisRow
}) {
  const t = useTranslations("theses")
  const tEnum = useTranslations("enums")
  const tc = useTranslations("common")
  const router = useRouter()
  const isEdit = Boolean(thesis)

  const form = useForm<ThesisFormValues, unknown, ThesisInput>({
    resolver: zodResolver(thesisInputSchema),
    defaultValues: { portfolioId, symbol, market, title: "", conviction: 5, status: "ACTIVE" },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      portfolioId,
      symbol: thesis?.symbol ?? symbol,
      market: toMarket(thesis?.market ?? market),
      title: thesis?.title ?? `${symbol} thesis`,
      whyBought: thesis?.why_bought ?? "",
      expectations: thesis?.expectations ?? "",
      catalysts: thesis?.catalysts ?? "",
      risks: thesis?.risks ?? "",
      invalidationCriteria: thesis?.invalidation_criteria ?? "",
      conviction: thesis?.conviction ?? 5,
      status: thesis?.status ?? "ACTIVE",
    })
  }, [open, thesis, portfolioId, symbol, market, form])

  const conviction = Number(form.watch("conviction")) || MIN_CONVICTION
  const errors = form.formState.errors

  const mutation = useMutation({
    mutationFn: (values: ThesisInput) =>
      apiFetch<ThesisRow>(isEdit ? `/api/theses/${thesis!.id}` : "/api/theses", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      toast.success(isEdit ? "Thesis updated." : "Thesis saved.")
      onOpenChange(false)
      router.refresh()
    },
    onError: (error: Error) => form.setError("root", { message: error.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit ${symbol} thesis` : `Why ${symbol}?`}</DialogTitle>
            <DialogDescription>
              What you expected, and what would change your mind. Only you set the status — Stockly
              puts facts beside a thesis and never decides one has failed.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="thesis-title">{t("title")}</Label>
              <Input
                id="thesis-title"
                aria-invalid={!!errors.title}
                {...form.register("title")}
              />
              {errors.title && <p className="text-destructive text-sm">{errors.title.message}</p>}
            </div>

            {FIELDS.map((field) => (
              <div key={field.name} className="space-y-2">
                <Label htmlFor={`thesis-${field.name}`}>{t(field.key)}</Label>
                <Textarea
                  id={`thesis-${field.name}`}
                  rows={3}
                  placeholder={t(`placeholders.${field.key}`)}
                  {...form.register(field.name)}
                />
              </div>
            ))}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="thesis-conviction">{t("conviction", { value: conviction })}</Label>
                <Input
                  id="thesis-conviction"
                  type="range"
                  min={MIN_CONVICTION}
                  max={MAX_CONVICTION}
                  step={1}
                  className="h-8 px-0 pointer-coarse:h-11"
                  {...form.register("conviction")}
                />
                {errors.conviction && (
                  <p className="text-destructive text-sm">{errors.conviction.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="thesis-status">{t("status")}</Label>
                <Select
                  value={(form.watch("status") as string) ?? "ACTIVE"}
                  onValueChange={(value) => form.setValue("status", value as ThesisStatus)}
                >
                  <SelectTrigger id="thesis-status" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {THESIS_STATUSES.map((status) => (
                      <SelectItem key={status} value={status}>
                        {tEnum(`thesisStatus.${status}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
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
              {isEdit ? "Save changes" : "Save thesis"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
