"use client"

import { Download } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const DATASETS = [
  { key: "summary", label: "Portfolio summary" },
  { key: "transactions", label: "Transactions" },
  { key: "dividends", label: "Dividends" },
  { key: "cash", label: "Cash transactions" },
] as const

/** Plain links to the export route: the browser downloads the response, no client-side blob needed. */
export function ExportMenu({ portfolioId }: { portfolioId: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="gap-2" />}>
        <Download className="size-4" aria-hidden />
        Export
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {DATASETS.map((dataset) => (
          <DropdownMenuItem
            key={dataset.key}
            nativeButton={false}
            render={
              <a
                href={`/api/analytics/export?portfolioId=${portfolioId}&dataset=${dataset.key}`}
                download
              />
            }
          >
            {dataset.label} (CSV)
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
