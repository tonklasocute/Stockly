"use client"

import { useQuery } from "@tanstack/react-query"
import { LineChart } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import type { TechnicalSnapshot } from "@/domain/technical"
import { apiFetch } from "@/lib/api-client"
import { TechnicalOverview } from "./technical-overview"
import { useTranslations } from "next-intl"

type Response = {
  snapshot: TechnicalSnapshot
  calculatedAt: string
  stale: boolean
  source: "cache" | "computed"
}

/**
 * Loaded client-side, after the page has rendered: computing indicators may need a fresh OHLCV
 * request, and the price header and holdings should not wait on it.
 */
export function TechnicalPanel({
  symbol,
  currency,
  market = "US",
}: {
  symbol: string
  currency?: string
  market?: string
}) {
  const t = useTranslations("technical")
  const { data, isPending, isError } = useQuery({
    queryKey: ["technical", market, symbol],
    queryFn: () => apiFetch<Response>(`/api/stocks/${symbol}/technical?market=${market}`),
    staleTime: 15 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  if (isPending) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={LineChart}
        title={t("unavailable")}
        description={t("unavailableBody")}
      />
    )
  }

  return (
    <TechnicalOverview
      snapshot={data.snapshot}
      calculatedAt={data.calculatedAt}
      stale={data.stale}
      currency={currency}
    />
  )
}
