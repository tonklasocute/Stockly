"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Lightbulb, Loader2, Pencil, Plus } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/empty-state"
import type { MarketId } from "@/domain/market"
import {
  THESIS_STATUSES,
  THESIS_STATUS_TONE,
  type ThesisObservation,
  type ThesisStatus,
} from "@/domain/research"
import { apiFetch } from "@/lib/api-client"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ThesisRow } from "@/types/database"
import { ThesisDialog } from "./thesis-dialog"
import { useAppLocale } from "@/lib/i18n/locale"
import { useTranslations } from "next-intl"

const TONE_CLASS = {
  neutral: "bg-muted text-foreground",
  positive: "bg-gain/10 text-gain",
  caution: "bg-muted text-foreground",
  negative: "bg-loss/10 text-loss",
} as const

export function ThesisBadge({ status, className }: { status: ThesisStatus; className?: string }) {
  const tEnum = useTranslations("enums")
  return (
    <span
      className={cn(
        "rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
        TONE_CLASS[THESIS_STATUS_TONE[status]],
        className,
      )}
    >
      {tEnum(`thesisStatus.${status}`)}
    </span>
  )
}

/** `column` is the database column; `key` names it in the reader's language. */
const SECTIONS = [
  { column: "why_bought", key: "whyBought" },
  { column: "expectations", key: "expect" },
  { column: "catalysts", key: "catalysts" },
  { column: "risks", key: "risks" },
  { column: "invalidation_criteria", key: "changeMind" },
] as const

/**
 * The thesis for one position, with observations beside it.
 *
 * The observations are measurements — "this position is 18% below its cost basis" — and never a
 * verdict. Status is changed only by the buttons below, which is to say only by the user: a system
 * that moved a thesis to BROKEN would be issuing a sell recommendation with extra steps.
 */
export function ThesisPanel({
  portfolioId,
  symbol,
  market,
  thesis,
  observations,
}: {
  portfolioId: string
  symbol: string
  market: MarketId
  thesis: ThesisRow | null
  observations: ThesisObservation[]
}) {
  const t = useTranslations("theses")
  const tEnum = useTranslations("enums")
  const tc = useTranslations("common")
  const locale = useAppLocale()
  const router = useRouter()
  const [dialogOpen, setDialogOpen] = useState(false)

  const setStatus = useMutation({
    mutationFn: (status: ThesisStatus) =>
      apiFetch(`/api/theses/${thesis!.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: thesis!.title,
          whyBought: thesis!.why_bought,
          expectations: thesis!.expectations,
          catalysts: thesis!.catalysts,
          risks: thesis!.risks,
          invalidationCriteria: thesis!.invalidation_criteria,
          conviction: thesis!.conviction,
          status,
        }),
      }),
    onSuccess: () => {
      toast.success(t("statusUpdated"))
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (!thesis) {
    return (
      <>
        <EmptyState
          icon={Lightbulb}
          title={t("none")}
          description={`Write down why you own ${symbol} and what would change your mind, while you can still remember.`}
          action={
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="size-4" aria-hidden />{t("write")}</Button>
          }
        />
        <ThesisDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          portfolioId={portfolioId}
          symbol={symbol}
          market={market}
        />
      </>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{thesis.title}</p>
            <ThesisBadge status={thesis.status} />
          </div>
          <p className="text-muted-foreground text-xs">
            Conviction {thesis.conviction}/10 · updated {formatTime(thesis.updated_at, locale)}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setDialogOpen(true)}>
          <Pencil className="size-3.5" aria-hidden />{tc("actions.edit")}</Button>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.filter((section) => thesis[section.column]).map((section) => (
          <div key={section.column} className="space-y-0.5">
            <dt className="text-muted-foreground text-xs">{t(section.key)}</dt>
            <dd className="text-sm whitespace-pre-wrap">{thesis[section.column]}</dd>
          </div>
        ))}
      </dl>

      {observations.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <p className="text-muted-foreground text-xs">{t("factsHint")}</p>
          <ul className="space-y-1">
            {observations.map((observation) => (
              <li key={observation.code} className="text-sm">
                {observation.text}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 border-t pt-3">
        <span className="text-muted-foreground self-center pr-1 text-xs">{t("setStatus")}</span>
        {THESIS_STATUSES.filter((status) => status !== thesis.status).map((status) => (
          <Button
            key={status}
            variant="outline"
            size="sm"
            disabled={setStatus.isPending}
            onClick={() => setStatus.mutate(status)}
          >
            {setStatus.isPending && setStatus.variables === status && (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            )}
            {tEnum(`thesisStatus.${status}`)}
          </Button>
        ))}
      </div>

      <ThesisDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        portfolioId={portfolioId}
        symbol={symbol}
        market={market}
        thesis={thesis}
      />
    </div>
  )
}
