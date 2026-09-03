"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { toCurrency } from "@/domain/market"
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
import { apiFetch } from "@/lib/api-client"
import type { PortfolioRow } from "@/types/database"
import {
  CURRENCIES,
  portfolioInputSchema,
  type PortfolioFormValues,
  type PortfolioInput,
} from "../schema"
import { useTranslations } from "next-intl"

export function PortfolioDialog({
  open,
  onOpenChange,
  portfolio,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Present when editing; absent when creating. */
  portfolio?: PortfolioRow
}) {
  const t = useTranslations("portfolios")
  const tc = useTranslations("common")
  const router = useRouter()
  const isEdit = Boolean(portfolio)

  const form = useForm<PortfolioFormValues, unknown, PortfolioInput>({
    resolver: zodResolver(portfolioInputSchema),
    defaultValues: { name: "", currency: "USD" },
  })

  useEffect(() => {
    if (open) {
      // The column is text, so a row written before the base-currency enum existed — or by hand —
      // can hold something the picker does not offer. Fall back rather than seeding an invalid form.
      form.reset({
        name: portfolio?.name ?? "",
        currency: toCurrency(portfolio?.currency) ?? "USD",
      })
    }
  }, [open, portfolio, form])

  const mutation = useMutation({
    mutationFn: (values: PortfolioInput) =>
      apiFetch<PortfolioRow>(isEdit ? `/api/portfolios/${portfolio!.id}` : "/api/portfolios", {
        method: isEdit ? "PATCH" : "POST",
        body: JSON.stringify(values),
      }),
    onSuccess: (saved) => {
      toast.success(isEdit ? "Portfolio updated." : "Portfolio created.")
      onOpenChange(false)
      // Server Components own the data; refresh re-derives holdings from the new transaction set.
      router.push(`?p=${saved.id}`)
      router.refresh()
    },
    onError: (error: Error) => form.setError("root", { message: error.message }),
  })

  const currency = form.watch("currency")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit portfolio" : "New portfolio"}</DialogTitle>
            <DialogDescription>
              {isEdit
                ? "Rename this portfolio or change its reporting currency."
                : "Group holdings however you like — by broker, strategy or market."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-5">
            <div className="space-y-2">
              <Label htmlFor="portfolio-name">{t("name")}</Label>
              <Input
                id="portfolio-name"
                placeholder={t("namePlaceholder")}
                autoFocus
                aria-invalid={!!form.formState.errors.name}
                {...form.register("name")}
              />
              {form.formState.errors.name && (
                <p className="text-destructive text-sm">{form.formState.errors.name.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="portfolio-currency">{t("currency")}</Label>
              <Select
                value={currency}
                onValueChange={(value) => form.setValue("currency", value ?? "USD")}
              >
                <SelectTrigger id="portfolio-currency" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.formState.errors.root && (
              <p className="text-destructive text-sm">{form.formState.errors.root.message}</p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" className="max-sm:h-11" onClick={() => onOpenChange(false)}>{tc("actions.cancel")}</Button>
            <Button type="submit" className="max-sm:h-11" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="size-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create portfolio"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
