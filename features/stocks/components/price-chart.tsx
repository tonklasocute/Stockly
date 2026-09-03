"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Area,
  Bar,
  Line,
  ComposedChart,
  ResponsiveContainer,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { LineChart } from "lucide-react"
import { bollingerBands, ema, macd as calcMacd, relativeVolume, rsi as calcRsi } from "@/domain/indicators"
import { EmptyState } from "@/components/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { apiFetch } from "@/lib/api-client"
import { formatCurrency } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { Candle, Range } from "@/services/market-data/types"
import { useTranslations } from "next-intl"
import { useIntlTag } from "@/lib/i18n/locale"

const RANGES: Range[] = ["1D", "1W", "1M", "3M", "6M", "1Y", "5Y"]

/**
 * Overlays sit on the price axis; panels get their own. Toggled individually because rendering all
 * of them at once is both unreadable and, on a phone, several thousand extra SVG segments.
 */
/*
 * `label` is an indicator's *name*, not prose: "EMA 20", "RSI" and "MACD" are the same in every
 * language and are written that way on every chart in the world. Only the two that are English
 * words — "Bollinger" and "Volume" — take a translation key, in `messageKey`.
 */
const OVERLAYS = [
  { key: "ema20", label: "EMA 20", colour: "var(--chart-1)" },
  { key: "ema50", label: "EMA 50", colour: "var(--chart-3)" },
  { key: "ema200", label: "EMA 200", colour: "var(--chart-4)" },
  { key: "bb", messageKey: "chart.bollinger", colour: "var(--chart-2)" },
] as const

const PANELS = [
  { key: "rsi", label: "RSI" },
  { key: "macd", label: "MACD" },
  { key: "volume", messageKey: "chart.volume" },
] as const

type OverlayKey = (typeof OVERLAYS)[number]["key"]
type PanelKey = (typeof PANELS)[number]["key"]

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

/** `intlTag` rather than a hardcoded locale: an axis label is text a reader reads. */
function labelFor(date: string, range: Range, tag: string): string {
  const parsed = new Date(date.includes("T") || date.includes(" ") ? date : `${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  const intraday = range === "1D" || range === "1W"
  return new Intl.DateTimeFormat(tag, {
    timeZone: "UTC",
    ...(intraday
      ? { hour: "numeric", minute: "2-digit", ...(range === "1W" ? { weekday: "short" } : {}) }
      : { month: "short", day: "numeric", ...(range === "5Y" ? { year: "2-digit" } : {}) }),
  }).format(parsed)
}

export function PriceChart({
  symbol,
  currency = "USD",
  market = "US",
}: {
  symbol: string
  currency?: string
  market?: string
}) {
  const t = useTranslations("stocks")
  const intlTag = useIntlTag()
  const [range, setRange] = useState<Range>("1M")
  // Defaults chosen to be legible rather than complete: two moving averages and nothing else.
  const [overlays, setOverlays] = useState<Set<OverlayKey>>(() => new Set<OverlayKey>(["ema50", "ema200"]))
  const [panel, setPanel] = useState<PanelKey | null>(null)

  const { data, isPending, isError } = useQuery({
    queryKey: ["history", market, symbol, range],
    queryFn: () =>
      apiFetch<{ candles: Candle[] }>(`/api/stocks/${symbol}/history?range=${range}&market=${market}`),
    // History is near-static; the server caches it too, so never refetch on focus.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  /*
   * Measured once per render rather than on resize: the difference between 150 and 250 points is
   * invisible, so re-downsampling as the window changes would be work for nothing.
   *
   * `?? []` is inside the memo, not outside it. Outside, it allocated a fresh array on every render
   * whenever `data` was undefined, which made the dependency change every time and defeated the
   * memo entirely — the thing it exists to avoid.
   */
  const candles = useMemo(() => {
    const width = typeof window === "undefined" ? 1024 : window.innerWidth
    return downsample(data?.candles ?? [], width < 640 ? 160 : width < 1024 ? 240 : 400)
  }, [data?.candles])
  const closes = candles.map((c) => c.close)

  /**
   * Indicators are computed here, on the downsampled series the chart actually draws, so what the
   * eye follows and what the line plots are the same points. The authoritative values in the
   * technical panel come from the server's full-history calculation — this is the drawing.
   */
  const enriched = useMemo(() => {
    const ema20 = ema(closes, 20)
    const ema50 = ema(closes, 50)
    const ema200 = ema(closes, 200)
    const bands = bollingerBands(closes, 20, 2)
    const rsiSeries = calcRsi(closes, 14)
    const macdResult = calcMacd(closes, 12, 26, 9)
    const rvol = relativeVolume(candles, 20)

    return candles.map((candle, i) => ({
      ...candle,
      ema20: ema20[i],
      ema50: ema50[i],
      ema200: ema200[i],
      bbUpper: bands.upper[i],
      bbLower: bands.lower[i],
      rsi: rsiSeries[i],
      macd: macdResult.macd[i],
      macdSignal: macdResult.signal[i],
      macdHistogram: macdResult.histogram[i],
      relativeVolume: rvol[i],
      volumeValue: candle.volume ?? 0,
    }))
  }, [candles, closes])
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
        aria-label={t("chart.range")}
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

      <div className="flex flex-wrap gap-1.5">
        {OVERLAYS.map((overlay) => {
          const on = overlays.has(overlay.key)
          return (
            <button
              key={overlay.key}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setOverlays((current) => {
                  const next = new Set(current)
                  if (next.has(overlay.key)) next.delete(overlay.key)
                  else next.add(overlay.key)
                  return next
                })
              }
              className={cn(
                "inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3",
                on ? "border-foreground/25" : "text-muted-foreground",
              )}
            >
              {/* A checkbox glyph as well as the colour, so state is never colour alone. */}
              <span aria-hidden>{on ? "☑" : "☐"}</span>
              <span
                className="size-2 rounded-full"
                style={{ background: overlay.colour, opacity: on ? 1 : 0.35 }}
                aria-hidden
              />
              {"label" in overlay ? overlay.label : t(overlay.messageKey)}
            </button>
          )
        })}
        {PANELS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={panel === option.key}
            onClick={() => setPanel((current) => (current === option.key ? null : option.key))}
            className={cn(
              "inline-flex min-h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3",
              panel === option.key ? "border-foreground/25" : "text-muted-foreground",
            )}
          >
            {"label" in option ? option.label : t(option.messageKey)}
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
            title={t("chart.errorTitle")}
            description={t("chart.errorBody")}
          />
        ) : candles.length === 0 ? (
          <EmptyState
            icon={LineChart}
            title={t("chart.unavailable")}
            description={`The provider has no ${range} price history for ${symbol}.`}
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={enriched} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`fill-${symbol}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(value: string) => labelFor(value, range, intlTag)}
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
                labelFormatter={(value) => labelFor(String(value), range, intlTag)}
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
              {overlays.has("bb") && (
                <>
                  <Line type="monotone" dataKey="bbUpper" stroke="var(--chart-2)" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="bbLower" stroke="var(--chart-2)" strokeWidth={1} strokeDasharray="3 3" dot={false} isAnimationActive={false} connectNulls />
                </>
              )}
              {OVERLAYS.filter((o) => o.key !== "bb" && overlays.has(o.key)).map((overlay) => (
                <Line
                  key={overlay.key}
                  type="monotone"
                  dataKey={overlay.key}
                  stroke={overlay.colour}
                  strokeWidth={1.25}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>

      {panel && candles.length > 0 && (
        <div className="h-28 border-t pt-2 sm:h-32">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={enriched} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis
                domain={panel === "rsi" ? [0, 100] : ["auto", "auto"]}
                tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
                width={62}
                tickFormatter={(v: number) => (panel === "volume" ? formatCompactNumber(v) : v.toFixed(0))}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--popover)",
                  border: "1px solid var(--border)",
                  borderRadius: "0.5rem",
                  color: "var(--popover-foreground)",
                  fontSize: "0.8125rem",
                }}
                labelFormatter={(value) => labelFor(String(value), range, intlTag)}
              />
              {panel === "rsi" && (
                <>
                  {/* The conventional 30/70 bands, drawn so the number has context. */}
                  <ReferenceLine y={70} stroke="var(--loss)" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <ReferenceLine y={30} stroke="var(--gain)" strokeDasharray="3 3" strokeOpacity={0.5} />
                  <Line type="monotone" dataKey="rsi" stroke="var(--chart-1)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                </>
              )}
              {panel === "macd" && (
                <>
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Bar dataKey="macdHistogram" fill="var(--chart-2)" isAnimationActive={false} />
                  <Line type="monotone" dataKey="macd" stroke="var(--chart-1)" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls />
                  <Line type="monotone" dataKey="macdSignal" stroke="var(--chart-4)" strokeWidth={1.25} dot={false} isAnimationActive={false} connectNulls />
                </>
              )}
              {panel === "volume" && (
                <Bar dataKey="volumeValue" fill="var(--chart-2)" isAnimationActive={false} />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

/*
 * Compact notation is identical in both languages — `4.4T`, `38M` — measured in
 * `domain/locale-boundary.test.ts`, so this stays on one tag rather than taking a locale that
 * would change nothing.
 */
function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}
