"use client"

import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTranslations } from "next-intl"

/** `key` is both the route parameter and the translation key — one word, one meaning. */
const DATASETS = ["summary", "transactions", "dividends", "cash"] as const

/** Plain links to the export route: the browser downloads the response, no client-side blob needed. */
export function ExportMenu({ portfolioId }: { portfolioId: string }) {
  const t = useTranslations("analytics")
  const tc = useTranslations("common")
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-2" />}>
        <Download className="size-4" aria-hidden />{tc("actions.export")}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {DATASETS.map((dataset) => (
          <DropdownMenuItem
            key={dataset}
            nativeButton={false}
            render={
              <a
                href={`/api/analytics/export?portfolioId=${portfolioId}&dataset=${dataset}`}
                download
              />
            }
          >
            {t(`export.${dataset}`)} (CSV)
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
