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
import { MarketSelect } from "@/components/market-select"
import { toMarket, type MarketId } from "@/domain/market"
import {
  JOURNAL_TYPES,
  SELL_REASONS,
  type JournalType,
  type SellReason,
} from "@/domain/research"
import { apiFetch } from "@/lib/api-client"
import type { JournalRow } from "@/types/database"
import { journalInputSchema, type JournalFormValues, type JournalInput } from "../schema"
import { useTranslations } from "next-intl"

function today() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Writing or editing a journal entry.
 *
 * `content` is stored and rendered as plain text — never markdown, never HTML — so there is nothing
 * here to escape and nothing downstream to sanitise. The same rule the AI layer follows for model
 * output, for the same reason: text that is only ever a React text node cannot become markup.
 */
export function JournalDialog({
  open,
  onOpenChange,
  portfolioId,
  entry,
  defaults,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolioId: string
  /** Present when editing. */
  entry?: JournalRow
  /** Prefilled when writing from a position page or a closed trade. */
  defaults?: {
    symbol?: string
    market?: MarketId
    type?: JournalType
    transactionId?: string
    title?: string
  }
}) {
  const t = useTranslations("journal")
  const tEnum = useTranslations("enums")
  const tc = useTranslations("common")
  const router = useRouter()
  const isEdit = Boolean(entry)

  const form = useForm<JournalFormValues, unknown, JournalInput>({
    resolver: zodResolver(journalInputSchema),
    defaultValues: { portfolioId, type: "GENERAL", title: "", content: "", entryDate: today() },
  })

  useEffect(() => {
    if (!open) return
    form.reset({
      portfolioId,
      type: entry?.type ?? defaults?.type ?? "GENERAL",
      symbol: entry?.symbol ?? defaults?.symbol ?? undefined,
      market: toMarket(entry?.market ?? defaults?.market),
      transactionId: entry?.transaction_id ?? defaults?.transactionId ?? undefined,
      reason: entry?.reason ?? undefined,
      title: entry?.title ?? defaults?.title ?? "",
      content: entry?.content ?? "",
      entryDate: entry?.entry_date?.slice(0, 10) ?? today(),
    })
  }, [open, entry, defaults, portfolioId, form])

  const type = form.watch("type") as JournalType
  const isSellReview = type === "SELL_REASON"
  const errors = form.formState.errors

  const mutation = useMutation({
    mutationFn: (values: JournalInput) =>
      apiFetch<JournalRow>(isEdit ? `/api/journal/${entry!.id}` : "/api/journal", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(
          isEdit
            ? {
                type: values.type,
                reason: values.reason ?? null,
                title: values.title,
                content: values.content,
                entryDate: values.entryDate,
              }
            : values,
        ),
      }),
    onSuccess: () => {
      toast.success(isEdit ? "Entry updated." : "Entry saved.")
      onOpenChange(false)
      router.refresh()
    },
    onError: (error: Error) => form.setError("root", { message: error.message }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit entry" : "New journal entry"}</DialogTitle>
            <DialogDescription>
              Your own reasoning, kept beside the numbers. Nothing you write here affects a single
              calculation.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="journal-type">{t("type")}</Label>
                <Select
                  value={type}
                  onValueChange={(value) => form.setValue("type", value as JournalType)}
                  disabled={Boolean(entry?.transaction_id)}
                >
                  <SelectTrigger id="journal-type" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {JOURNAL_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {tEnum(`journalType.${t}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="journal-date">{t("date")}</Label>
                <Input
                  id="journal-date"
                  type="date"
                  max={today()}
                  aria-invalid={!!errors.entryDate}
                  {...form.register("entryDate")}
                />
                {errors.entryDate && (
                  <p className="text-destructive text-sm">{errors.entryDate.message}</p>
                )}
              </div>
            </div>

            {isSellReview && (
              <div className="space-y-2">
                <Label htmlFor="journal-reason">{t("whySold")}</Label>
                <Select
                  value={(form.watch("reason") as string) ?? ""}
                  onValueChange={(value) => form.setValue("reason", value as SellReason)}
                >
                  <SelectTrigger id="journal-reason" className="w-full">
                    <SelectValue placeholder={t("chooseReason")} />
                  </SelectTrigger>
                  <SelectContent>
                    {SELL_REASONS.map((reason) => (
                      <SelectItem key={reason} value={reason}>
                        {tEnum(`sellReason.${reason}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.reason && <p className="text-destructive text-sm">{errors.reason.message}</p>}
                <p className="text-muted-foreground text-xs">
                  The profit or loss on this trade is computed from the transaction itself and is
                  never entered here.
                </p>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="journal-symbol">{t("symbol")}<span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <Input
                  id="journal-symbol"
                  placeholder="NVDA"
                  autoCapitalize="characters"
                  autoComplete="off"
                  className="uppercase"
                  disabled={Boolean(entry) || Boolean(defaults?.symbol)}
                  aria-invalid={!!errors.symbol}
                  {...form.register("symbol")}
                />
                {errors.symbol && <p className="text-destructive text-sm">{errors.symbol.message}</p>}
              </div>

              <MarketSelect
                id="journal-market"
                value={toMarket(form.watch("market"))}
                onChange={(next) => form.setValue("market", next)}
                disabled={Boolean(entry) || Boolean(defaults?.symbol)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="journal-title">{t("title")}</Label>
              <Input
                id="journal-title"
                placeholder={t("whyBought")}
                aria-invalid={!!errors.title}
                {...form.register("title")}
              />
              {errors.title && <p className="text-destructive text-sm">{errors.title.message}</p>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="journal-content">{t("notes")}</Label>
              <Textarea
                id="journal-content"
                rows={6}
                placeholder={t("thinkingHint")}
                {...form.register("content")}
              />
              {errors.content && <p className="text-destructive text-sm">{errors.content.message}</p>}
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
              {isEdit ? "Save changes" : "Save entry"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
