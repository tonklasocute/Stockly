"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { LineChart } from "lucide-react"
import { EmptyState } from "@/components/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch } from "@/lib/api-client"
import { formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Candle, Range } from "@/services/market-data/types"

const RANGES: Range[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"]

/**
 * A 390px screen cannot show 252 daily closes — the extra points are sub-pixel, and every one of
 * them is an SVG path segment to lay out and repaint. Keeping roughly one point per two pixels drops
 * the work without changing what the chart says; the first and last candle always survive, so the
 * range's endpoints stay exact.
 */
function downsample(candles: Candle[], maxPoints: number): Candle[] {
  if (candles.length <= maxPoints) return candles
  const step = Math.ceil(candles.length / maxPoints)
  const out = candles.filter((_, index) => index % step === 0)
  const last = candles[candles.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

function labelFor(date: string, range: Range): string {
  const parsed = new Date(date.includes("T") || date.includes(" ") ? date : `${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  const intraday = range === "1D" || range === "1W"
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    ...(intraday
      ? { hour: "numeric", minute: "2-digit", ...(range === "1W" ? { weekday: "short" } : {}) }
      : { month: "short", day: "numeric", ...(range === "5Y" ? { year: "2-digit" } : {}) }),
  }).format(parsed)
}

export function PriceChart({
  symbol,
  currency = "USD",
}: {
  symbol: string
  currency?: string
}) {
  const [range, setRange] = useState<Range>("1M")

  const { data, isPending, isError } = useQuery({
    queryKey: ["history", symbol, range],
    queryFn: () => apiFetch<{ candles: Candle[] }>(`/api/stocks/${symbol}/history?range=${range}`),
    // History is near-static; the server caches it too, so never refetch on focus.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const raw = data?.candles ?? []
  // Measured once per render rather than on resize: the difference between 150 and 250 points is
  // invisible, so re-downsampling as the window changes would be work for nothing.
  const candles = useMemo(() => {
    const width = typeof window === "undefined" ? 1024 : window.innerWidth
    return downsample(raw, width < 640 ? 160 : width < 1024 ? 240 : 400)
  }, [raw])
  const closes = candles.map((c) => c.close)
  // A chart of prices should not start at zero — it flattens every real move.
  const min = closes.length ? Math.min(...closes) : 0
  const max = closes.length ? Math.max(...closes) : 0
  const pad = (max - min || max * 0.02) * 0.12
  const rising = closes.length > 1 && closes[closes.length - 1] >= closes[0]
  const stroke = rising ? "var(--gain)" : "var(--loss)"

  return (
    <div className="space-y-3">
      <div
        className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        aria-label="Chart range"
      >
        {RANGES.map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={range === value}
            onClick={() => setRange(value)}
            className={cn(
              "min-h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:px-3",
              range === value
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            {value}
          </button>
        ))}
      </div>

      {/* Fixed height in every state, so switching range never makes the page jump. */}
      <div className="h-64 sm:h-72">
        {isPending ? (
          <Skeleton className="size-full rounded-xl" />
        ) : isError ? (
          <EmptyState
            icon={LineChart}
            title="Unable to load market data"
            description="The price history could not be loaded. Please try again later."
          />
        ) : candles.length === 0 ? (
          <EmptyState
            icon={LineChart}
            title="Historical data is unavailable"
            description={`The provider has no ${range} price history for ${symbol}.`}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={candles} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`fill-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => labelFor(value, range)}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                minTickGap={40}
              />
              <YAxis
                domain={[min - pad, max + pad]}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={62}
                tickFormatter={(value: number) => formatCurrency(value, currency, 0)}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  color: "var(--popover-foreground)",
                  fontSize: "0.8125rem",
                }}
                labelFormatter={(value) => labelFor(String(value), range)}
                formatter={(value) => [formatCurrency(Number(value), currency), "Close"]}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={stroke}
                strokeWidth={1.75}
                fill={`url(#fill-${symbol})`}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
