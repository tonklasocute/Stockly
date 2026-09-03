"use client"

import { useState } from "react"
import Link from "next/link"
import { useMutation } from "@tanstack/react-query"
import { Filter, Loader2, Play, Plus, Save, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/empty-state"
import { NaturalLanguageScreener } from "@/features/ai/components/nl-screener"
import {
  CROSSABLE_METRICS,
  METRIC_LABELS,
  OPERATOR_LABELS,
  RELATIVE_METRICS,
  SCREENER_METRICS,
  SCREENER_OPERATORS,
  SCREENER_PRESETS,
  type ScreenerDefinition,
  type ScreenerFilter,
  type ScreenerMetric,
  type ScreenerOperator,
} from "@/domain/screener"
import { apiFetch } from "@/lib/api-client"
import { formatCurrency, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { SavedScreenRow } from "@/types/database"

type Row = {
  symbol: string
  market: string
  /** The instrument's own currency — the price column is never translated. */
  currency: string
  name: string | null
  price: number | null
  rsi: number | null
  adx: number | null
  relativeVolume: number | null
  score: number | null
  trend: string
  stale: boolean
  calculatedAt: string
}

type RunResult = {
  rows: Row[]
  page: number
  pageCount: number
  total: number
  examined: number
  evaluable: number
  anyStale: boolean
  oldestCalculatedAt: string | null
}

const EMPTY: ScreenerDefinition = { logic: "AND", filters: [] }

/** Units decide the suffix and the sensible default, so a new RSI filter does not start at $0. */
function defaultValueFor(metric: ScreenerMetric): number {
  if (metric === "RSI") return 30
  if (metric === "ADX") return 25
  if (metric === "RELATIVE_VOLUME") return 1.5
  if (metric === "TECHNICAL_SCORE") return 70
  if (metric === "PRICE") return 10
  return 0
}

function suffixFor(metric: ScreenerMetric): string {
  if (RELATIVE_METRICS.includes(metric)) return "%"
  if (metric === "RELATIVE_VOLUME") return "×"
  if (metric === "PRICE") return "$"
  return ""
}

export function ScreenerClient({
  savedScreens,
  aiEnabled = false,
}: {
  savedScreens: SavedScreenRow[]
  aiEnabled?: boolean
}) {
  const [definition, setDefinition] = useState<ScreenerDefinition>(
    SCREENER_PRESETS[0]?.definition ?? EMPTY,
  )
  const [result, setResult] = useState<RunResult | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState("")

  const run = useMutation({
    mutationFn: (page: number) =>
      apiFetch<RunResult>("/api/screener", {
        method: "POST",
        body: JSON.stringify({ definition, page }),
      }),
    onSuccess: (data) => {
      setResult(data)
      setFiltersOpen(false)
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const save = useMutation({
    mutationFn: () =>
      apiFetch("/api/screener/saved", {
        method: "POST",
        body: JSON.stringify({ name: saveName, definition }),
      }),
    onSuccess: () => {
      toast.success("Screen saved.")
      setSaveOpen(false)
      setSaveName("")
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/screener/saved/${id}`, { method: "DELETE" }),
    onSuccess: () => toast.success("Screen deleted."),
    onError: (error: Error) => toast.error(error.message),
  })

  function updateFilter(index: number, patch: Partial<ScreenerFilter>) {
    setDefinition((current) => ({
      ...current,
      filters: current.filters.map((f, i) => (i === index ? { ...f, ...patch } : f)),
    }))
  }

  function addFilter() {
    setDefinition((current) => ({
      ...current,
      filters: [...current.filters, { metric: "RSI", operator: "LT", value: 30 }],
    }))
  }

  const filterEditor = (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground text-sm">Match</span>
        <Select
          value={definition.logic}
          onValueChange={(value) =>
            setDefinition((c) => ({ ...c, logic: (value as "AND" | "OR") ?? "AND" }))
          }
        >
          <SelectTrigger aria-label="Match all or any" className="w-28">
            <SelectValue>{(v) => (v === "OR" ? "any of" : "all of")}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">all of</SelectItem>
            <SelectItem value="OR">any of</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-sm">these conditions</span>
      </div>

      <ul className="space-y-2">
        {definition.filters.map((filter, index) => {
          const crossable = CROSSABLE_METRICS.includes(filter.metric)
          const isCross = filter.operator === "CROSS_ABOVE" || filter.operator === "CROSS_BELOW"
          return (
            <li key={index} className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
              <Select
                value={filter.metric}
                onValueChange={(value) => {
                  const metric = (value as ScreenerMetric) ?? "RSI"
                  updateFilter(index, { metric, value: defaultValueFor(metric) })
                }}
              >
                <SelectTrigger aria-label="Metric" className="w-full">
                  <SelectValue>{(v) => METRIC_LABELS[v as ScreenerMetric]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SCREENER_METRICS.map((metric) => (
                    <SelectItem key={metric} value={metric}>
                      {METRIC_LABELS[metric]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filter.operator}
                onValueChange={(value) =>
                  updateFilter(index, { operator: (value as ScreenerOperator) ?? "GT" })
                }
              >
                <SelectTrigger aria-label="Operator" className="sm:w-44">
                  <SelectValue>{(v) => OPERATOR_LABELS[v as ScreenerOperator]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SCREENER_OPERATORS.filter(
                    (op) => crossable || (op !== "CROSS_ABOVE" && op !== "CROSS_BELOW"),
                  ).map((op) => (
                    <SelectItem key={op} value={op}>
                      {OPERATOR_LABELS[op]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {filter.metric === "TREND" ? (
                <Select
                  value={String(filter.value)}
                  onValueChange={(value) => updateFilter(index, { value: (value as never) ?? "bullish" })}
                >
                  <SelectTrigger aria-label="Trend" className="sm:w-32">
                    <SelectValue>{(v) => String(v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {["bullish", "neutral", "bearish"].map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : isCross ? (
                <span className="text-muted-foreground text-sm sm:w-32">on the latest bar</span>
              ) : (
                <div className="relative sm:w-32">
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="any"
                    aria-label={`${METRIC_LABELS[filter.metric]} value`}
                    className="tabular pr-7"
                    value={String(filter.value)}
                    onChange={(event) => updateFilter(index, { value: Number(event.target.value) })}
                  />
                  <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs">
                    {suffixFor(filter.metric)}
                  </span>
                </div>
              )}

              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove this condition"
                onClick={() =>
                  setDefinition((c) => ({ ...c, filters: c.filters.filter((_, i) => i !== index) }))
                }
              >
                <X className="size-4" aria-hidden />
              </Button>
            </li>
          )
        })}
      </ul>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="gap-2" onClick={addFilter} disabled={definition.filters.length >= 10}>
          <Plus className="size-4" aria-hidden />
          Add condition
        </Button>
        <Button size="sm" className="gap-2" disabled={run.isPending} onClick={() => run.mutate(1)}>
          {run.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Play className="size-4" aria-hidden />}
          Run screener
        </Button>
        <Button variant="outline" size="sm" className="gap-2" onClick={() => setSaveOpen(true)}>
          <Save className="size-4" aria-hidden />
          Save
        </Button>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">
      {/* The AI only ever fills in the editor below. Running the screen stays a deliberate press
          of "Run screener", against the same endpoint a hand-built screen uses. */}
      <NaturalLanguageScreener enabled={aiEnabled} onApply={setDefinition} />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Presets</h2>
        <p className="text-muted-foreground text-xs">
          Every preset is an ordinary set of conditions — select one to see and edit exactly what it
          screens for.
        </p>
        <ul className="flex flex-wrap gap-2">
          {SCREENER_PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                onClick={() => setDefinition(preset.definition)}
                title={preset.description}
                className="hover:bg-accent inline-flex min-h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3"
              >
                {preset.name}
              </button>
            </li>
          ))}
        </ul>
      </section>

      {savedScreens.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">My screens</h2>
          <ul className="flex flex-wrap gap-2">
            {savedScreens.map((screen) => (
              <li key={screen.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDefinition(screen.definition as ScreenerDefinition)}
                  className="hover:bg-accent inline-flex min-h-8 items-center rounded-lg border px-2.5 text-xs font-medium transition-colors pointer-coarse:min-h-11 pointer-coarse:px-3"
                >
                  {screen.name}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete ${screen.name}`}
                  onClick={() => remove.mutate(screen.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Desktop edits inline; mobile opens the same editor as a bottom sheet. */}
      <section className="hidden rounded-xl border p-4 lg:block">{filterEditor}</section>
      <div className="lg:hidden">
        <Button variant="outline" className="w-full gap-2" onClick={() => setFiltersOpen(true)}>
          <Filter className="size-4" aria-hidden />
          Filters ({definition.filters.length})
        </Button>
      </div>

      <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Filters</DialogTitle>
            <DialogDescription>Every condition is checked against the latest snapshot.</DialogDescription>
          </DialogHeader>
          <div className="py-4">{filterEditor}</div>
        </DialogContent>
      </Dialog>

      <section className="space-y-3">
        {result === null ? (
          <div className="rounded-xl border">
            <EmptyState
              icon={Search}
              title="Run a screen"
              description="Choose a preset or build your own conditions, then run it against the tracked universe."
            />
          </div>
        ) : result.rows.length === 0 ? (
          <div className="rounded-xl border">
            <EmptyState
              icon={Search}
              title="No matches"
              description={`None of the ${result.evaluable} stocks with enough history met those conditions.`}
            />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-muted-foreground text-sm">
                {result.total} match{result.total === 1 ? "" : "es"} of {result.evaluable} screened
              </p>
              {result.oldestCalculatedAt && (
                <p className="text-muted-foreground text-xs">
                  Indicators as of {formatTime(result.oldestCalculatedAt)}
                  {result.anyStale && " · may be delayed"}
                </p>
              )}
            </div>

            <ul className="grid gap-2 lg:hidden">
              {result.rows.map((row) => (
                <li key={`${row.market}:${row.symbol}`} className="bg-card rounded-xl border p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/stocks/${row.symbol}?market=${row.market}`} className="tap min-w-0 flex-col !items-start">
                      <span className="block font-semibold">{row.symbol}</span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {row.name ?? row.trend}
                      </span>
                    </Link>
                    <span className="tabular font-semibold">
                      {row.price === null ? "N/A" : formatCurrency(row.price, row.currency)}
                    </span>
                  </div>
                  <dl className="text-muted-foreground mt-2.5 grid grid-cols-4 gap-2 border-t pt-2.5 text-xs">
                    <div>
                      <dt>RSI</dt>
                      <dd className="tabular text-foreground">{row.rsi?.toFixed(0) ?? "N/A"}</dd>
                    </div>
                    <div>
                      <dt>ADX</dt>
                      <dd className="tabular text-foreground">{row.adx?.toFixed(0) ?? "N/A"}</dd>
                    </div>
                    <div>
                      <dt>RVOL</dt>
                      <dd className="tabular text-foreground">
                        {row.relativeVolume === null ? "N/A" : `${row.relativeVolume.toFixed(1)}×`}
                      </dd>
                    </div>
                    <div>
                      <dt>Score</dt>
                      <dd className="tabular text-foreground">{row.score ?? "N/A"}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>

            <div className="hidden overflow-hidden rounded-xl border lg:block">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Symbol</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">RSI</TableHead>
                    <TableHead className="text-right">ADX</TableHead>
                    <TableHead className="text-right">Rel volume</TableHead>
                    <TableHead className="text-right">Score</TableHead>
                    <TableHead>Trend</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.rows.map((row) => (
                    <TableRow key={`${row.market}:${row.symbol}`}>
                      <TableCell>
                        <Link href={`/stocks/${row.symbol}?market=${row.market}`} className="tap font-medium underline-offset-4 hover:underline">
                          {row.symbol}
                        </Link>
                        {row.name && <span className="text-muted-foreground ml-2 text-xs">{row.name}</span>}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {row.price === null ? "N/A" : formatCurrency(row.price, row.currency)}
                      </TableCell>
                      <TableCell className="tabular text-right">{row.rsi?.toFixed(0) ?? "N/A"}</TableCell>
                      <TableCell className="tabular text-right">{row.adx?.toFixed(0) ?? "N/A"}</TableCell>
                      <TableCell className="tabular text-right">
                        {row.relativeVolume === null ? "N/A" : `${row.relativeVolume.toFixed(1)}×`}
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">{row.score ?? "N/A"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn(
                            "capitalize",
                            row.trend === "bullish" && "border-gain/40 text-gain",
                            row.trend === "bearish" && "border-loss/40 text-loss",
                          )}
                        >
                          {row.trend === "bullish" ? "▲" : row.trend === "bearish" ? "▼" : "■"} {row.trend}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {result.pageCount > 1 && (
              <div className="flex items-center justify-between gap-3">
                <p className="text-muted-foreground text-sm">
                  Page {result.page} of {result.pageCount}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={result.page <= 1 || run.isPending}
                    onClick={() => run.mutate(result.page - 1)}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={result.page >= result.pageCount || run.isPending}
                    onClick={() => run.mutate(result.page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save this screen</DialogTitle>
            <DialogDescription>
              The conditions are stored as structured data, so you can reopen and edit them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-4">
            <Label htmlFor="screen-name">Name</Label>
            <Input
              id="screen-name"
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              placeholder="Oversold growth"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSaveOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!saveName.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-muted-foreground text-xs">
        Technical indicators are analytical tools describing past price and volume. They do not
        predict future performance and are not investment advice.
      </p>
    </div>
  )
}
