"use client"

import { useQuery } from "@tanstack/react-query"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Delta } from "@/components/value"
import { formatCurrency, formatTime } from "@/lib/format"
import { apiFetch } from "@/lib/api-client"
import { cn } from "@/lib/utils"
import type { Quote } from "@/services/market-data/types"
import { useAppLocale } from "@/lib/i18n/locale"

const STATUS_LABEL: Record<Quote["status"], string> = {
  open: "Market open",
  closed: "Market closed",
  pre: "Pre-market",
  post: "After hours",
  unknown: "Market status unavailable",
}

/**
 * Price header. Seeded from the server-rendered quote so nothing ever flashes empty, then polled.
 *
 * Polling is deliberately conservative: the free tier bills one credit per symbol, and
 * refetchIntervalInBackground stays off so a phone in a pocket stops spending quota and battery.
 */
export function LiveQuote({
  symbol,
  initialQuote,
  currency = "USD",
  market = "US",
}: {
  symbol: string
  market?: string
  initialQuote: Quote | null
  currency?: string
}) {
  const locale = useAppLocale()
  const { data, isFetching, refetch, isError } = useQuery({
    queryKey: ["quote", market, symbol],
    queryFn: () =>
      apiFetch<{ quote: Quote }>(`/api/stocks/${symbol}/quote?market=${market}`).then((r) => r.quote),
    initialData: initialQuote ?? undefined,
    staleTime: 30_000,
    // Only while the market is open and only while the tab is visible.
    refetchInterval: (query) => (query.state.data?.status === "open" ? 60_000 : false),
    refetchIntervalInBackground: false,
    retry: false,
  })

  const quote = data ?? initialQuote

  if (!quote) {
    return (
      <p className="text-muted-foreground text-sm">
        Unable to load market data. Please try again later.
      </p>
    )
  }

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="tabular text-3xl font-semibold tracking-tight sm:text-4xl">
          {formatCurrency(quote.price, quote.currency ?? currency)}
        </span>
        {quote.change !== null && (
          <Delta
            value={quote.change}
            currency={quote.currency ?? currency}
            percent={quote.changePct ?? undefined}
            className="text-base"
          />
        )}
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span
          className={cn(
            "inline-flex items-center gap-1.5",
            quote.status === "open" && "text-gain",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              quote.status === "open" ? "bg-gain" : "bg-muted-foreground/50",
            )}
            aria-hidden
          />
          {STATUS_LABEL[quote.status]}
        </span>
        <span aria-hidden>·</span>
        <span>{isError ? "Price may be out of date" : `As of ${formatTime(quote.asOf, locale)}`}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => refetch()}
          disabled={isFetching}
          aria-label="Refresh price"
        >
          <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden />
        </Button>
      </div>
    </div>
  )
}
