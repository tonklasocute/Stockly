"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { type ScreenerDefinition } from "@/domain/screener"
import { apiFetch } from "@/lib/api-client"
import { useTranslations } from "next-intl"

/**
 * Natural language into screener filters.
 *
 * **The proposal is always shown before it can run.** The model returns `{ metric, operator, value }`
 * triples, the server validates them against the same closed enums a hand-built screen uses, and
 * the user sees exactly what will execute. Nothing runs on the model's say-so.
 */
type Proposed = { definition: ScreenerDefinition; explanation: string }

export function NaturalLanguageScreener({
  enabled,
  onApply,
}: {
  enabled: boolean
  onApply: (definition: ScreenerDefinition) => void
}) {
  const t = useTranslations("ai")
  const tEnum = useTranslations("enums")
  const [query, setQuery] = useState("")
  const [proposal, setProposal] = useState<Proposed | null>(null)

  const translate = useMutation({
    mutationFn: () =>
      apiFetch<Proposed>("/api/ai/screener", {
        method: "POST",
        body: JSON.stringify({ query }),
      }),
    onSuccess: setProposal,
  })

  if (!enabled) return null

  return (
    <section className="space-y-3 rounded-xl border p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">{t("screener.describe")}</h2>
        <p className="text-muted-foreground text-xs">{t("screener.hint")}</p>
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (query.trim()) translate.mutate()
        }}
      >
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="nl-screen" className="sr-only">{t("screener.label")}</Label>
          <Input
            id="nl-screen"
            value={query}
            maxLength={1000}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("screener.placeholder")}
          />
        </div>
        <Button type="submit" className="gap-2" disabled={!query.trim() || translate.isPending}>
          {translate.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="size-4" aria-hidden />
          )}
          Build filters
        </Button>
      </form>

      {translate.isError && (
        <p className="text-sm">{(translate.error as Error).message}</p>
      )}

      {proposal && (
        <div className="space-y-3 rounded-lg border border-dashed p-3.5">
          <p className="text-muted-foreground text-xs">{proposal.explanation}</p>
          <ul className="space-y-1">
            {proposal.definition.filters.map((filter, index) => (
              <li key={index} className="text-sm">
                <span className="text-muted-foreground text-xs">
                  {index === 0 ? "" : `${proposal.definition.logic} `}
                </span>
                {tEnum(`screenerMetric.${filter.metric}`)} {tEnum(`screenerOperator.${filter.operator}`)}{" "}
                <span className="tabular font-medium">{String(filter.value)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => {
                onApply(proposal.definition)
                setProposal(null)
              }}
            >{t("screener.use")}</Button>
            <Button variant="ghost" size="sm" onClick={() => setProposal(null)}>{t("screener.discard")}</Button>
          </div>
          <p className="text-muted-foreground text-xs">{t("screener.disclaimer")}</p>
        </div>
      )}
    </section>
  )
}
