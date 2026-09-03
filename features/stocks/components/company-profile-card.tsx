"use client"

import { useState } from "react"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { formatCompact } from "@/lib/format"
import type { CompanyProfile } from "@/services/market-data/types"
import { useTranslations } from "next-intl"

/** Descriptions run to several hundred words; on a phone that has to be collapsible. */
export function CompanyProfileCard({ profile }: { profile: CompanyProfile }) {
  const t = useTranslations("stocks")
  const [expanded, setExpanded] = useState(false)

  const facts = [
    { label: t("profile.exchange"), value: profile.exchange },
    { label: t("profile.sector"), value: profile.sector },
    { label: t("profile.industry"), value: profile.industry },
    { label: t("profile.country"), value: profile.country },
    { label: t("profile.marketCap"), value: profile.marketCap === null ? null : formatCompact(profile.marketCap) },
    {
      label: t("profile.employees"),
      value: profile.employees === null ? null : formatCompact(profile.employees),
    },
  ].filter((fact): fact is { label: string; value: string } => Boolean(fact.value))

  // Nothing but a name is not a profile worth a card.
  if (facts.length === 0 && !profile.description && !profile.website) return null

  return (
    <section className="bg-card space-y-4 rounded-xl border p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-semibold">About {profile.name}</h2>
        {profile.website && (
          <a
            href={profile.website}
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-4 hover:underline"
          >{t("profile.website")}<ExternalLink className="size-3" aria-hidden />
          </a>
        )}
      </div>

      {facts.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          {facts.map(({ label, value }) => (
            <div key={label} className="min-w-0 space-y-0.5">
              <dt className="text-muted-foreground text-xs">{label}</dt>
              <dd className="truncate text-sm font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {profile.description && (
        <div className="space-y-1.5">
          <p className={`text-muted-foreground text-sm ${expanded ? "" : "line-clamp-3"}`}>
            {profile.description}
          </p>
          {profile.description.length > 220 && (
            <Button
              variant="link"
              size="xs"
              className="h-auto px-0"
              onClick={() => setExpanded((previous) => !previous)}
            >
              {expanded ? "Show less" : "Read more"}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
