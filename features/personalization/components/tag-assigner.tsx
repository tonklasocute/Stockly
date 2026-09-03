"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Section } from "@/components/metric"
import { TAG_CLASSES } from "@/features/personalization/tag-colors"
import { apiFetch } from "@/lib/api-client"
import type { TagRow } from "@/types/database"
import { useTranslations } from "next-intl"

/**
 * Applying tags to positions.
 *
 * A grid of checkboxes rather than a menu per row: tagging is something people do to several
 * positions at once, when they are thinking about the shape of a portfolio rather than about one
 * stock. It is keyboard-navigable by construction — every control is a real checkbox with a label.
 *
 * A tag is metadata. Nothing here can change a quantity, a cost basis or a P&L figure, and
 * `domain/personalization-boundary.test.ts` proves it for the whole layer.
 */
export function TagAssigner({
  portfolioId,
  tags,
  holdings,
  assigned,
}: {
  portfolioId: string
  tags: TagRow[]
  holdings: { symbol: string; market: string }[]
  /** Tag ids per `market:symbol`. */
  assigned: Record<string, string[]>
}) {
  const t = useTranslations("personalization")
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [local, setLocal] = useState(assigned)
  const [, startTransition] = useTransition()

  if (tags.length === 0) {
    return (
      <Section title={t("tags.title")} description={t("tags.createHint")}>
        <p className="text-muted-foreground text-sm">{t("tags.noneYet")}</p>
      </Section>
    )
  }

  const toggle = async (symbol: string, market: string, tagId: string, on: boolean) => {
    const key = `${market}:${symbol}`
    const previous = local
    // Optimistic, then reverted on failure: a checkbox that stays ticked after a failed write is a
    // checkbox that lies about what is stored.
    setLocal((current) => ({
      ...current,
      [key]: on ? [...(current[key] ?? []), tagId] : (current[key] ?? []).filter((id) => id !== tagId),
    }))
    setBusy(true)
    try {
      await apiFetch("/api/tags/assign", {
        method: on ? "POST" : "DELETE",
        body: JSON.stringify({ portfolioId, tagId, market, symbol }),
      })
      startTransition(() => router.refresh())
    } catch (error) {
      setLocal(previous)
      toast.error(error instanceof Error ? error.message : "Could not save that tag.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title={t("tags.title")} description={t("tags.description")}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t("tags.applyTo")}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-muted-foreground py-2 pr-4 text-left text-xs font-medium">{t("tags.position")}</th>
              {tags.map((tag) => (
                <th key={tag.id} scope="col" className="px-2 py-2 text-center">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] ${TAG_CLASSES[tag.color] ?? TAG_CLASSES.slate}`}>
                    {tag.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {holdings.map(({ symbol, market }) => {
              const key = `${market}:${symbol}`
              return (
                <tr key={key}>
                  <th scope="row" className="py-2 pr-4 text-left font-medium">
                    {symbol}
                    <span className="text-muted-foreground ml-2 text-xs">{market}</span>
                  </th>
                  {tags.map((tag) => {
                    const checked = (local[key] ?? []).includes(tag.id)
                    return (
                      <td key={tag.id} className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={busy}
                          aria-label={`${tag.name} on ${symbol}`}
                          onChange={(event) => void toggle(symbol, market, tag.id, event.target.checked)}
                          className="pointer-coarse:size-5"
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Section>
  )
}
