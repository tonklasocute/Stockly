"use client"

import { useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { useMutation } from "@tanstack/react-query"
import { BookOpen, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { EmptyState } from "@/components/empty-state"
import { MarketBadge } from "@/components/market-badge"
import { currencyOf, toMarket } from "@/domain/market"
import { JOURNAL_LABELS, JOURNAL_TYPES, SELL_REASON_LABELS } from "@/domain/research"
import { apiFetch } from "@/lib/api-client"
import { formatDate } from "@/lib/format"
import type { JournalRow } from "@/types/database"
import { JournalDialog } from "./journal-dialog"
import { useAppLocale } from "@/lib/i18n/locale"

/**
 * The journal timeline: filters in the URL, entries newest first.
 *
 * Filtering is a server round trip rather than a client-side `.filter()` — a journal grows without
 * bound, and the page only ever holds twenty-five entries, so filtering what is in memory would
 * search the wrong set.
 */
export function JournalTimeline({
  portfolioId,
  entries,
  instruments,
  total,
}: {
  portfolioId: string
  entries: JournalRow[]
  instruments: Array<{ symbol: string; market: string }>
  total: number
}) {
  const locale = useAppLocale()
  const router = useRouter()
  const params = useSearchParams()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<JournalRow | undefined>()
  const [query, setQuery] = useState(params.get("q") ?? "")

  const type = params.get("type") ?? "all"
  const symbol = params.get("symbol") ?? "all"

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString())
    if (value && value !== "all") next.set(key, value)
    else next.delete(key)
    // A new filter starts at the first page; keeping the old page number would show an empty one.
    next.delete("page")
    router.push(`/journal?${next.toString()}`)
  }

  const remove = useMutation({
    mutationFn: (entry: JournalRow) => apiFetch(`/api/journal/${entry.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Entry deleted.")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <form
          className="relative min-w-40 flex-1"
          onSubmit={(event) => {
            event.preventDefault()
            setParam("q", query.trim())
          }}
        >
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search entries"
            aria-label="Search journal"
            className="pl-9"
          />
        </form>

        <Select value={type} onValueChange={(value) => setParam("type", value ?? "all")}>
          <SelectTrigger aria-label="Filter by type" className="sm:w-40">
            <SelectValue>
              {(value) => (value === "all" ? "All types" : JOURNAL_LABELS[value as keyof typeof JOURNAL_LABELS])}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {JOURNAL_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {JOURNAL_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {instruments.length > 0 && (
          <Select value={symbol} onValueChange={(value) => setParam("symbol", value ?? "all")}>
            <SelectTrigger aria-label="Filter by symbol" className="sm:w-36">
              <SelectValue>{(value) => (value === "all" ? "All symbols" : String(value))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All symbols</SelectItem>
              {instruments.map((instrument) => (
                <SelectItem key={`${instrument.market}:${instrument.symbol}`} value={instrument.symbol}>
                  {instrument.symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          onClick={() => {
            setEditing(undefined)
            setDialogOpen(true)
          }}
          className="gap-2 max-sm:h-11 max-sm:w-full"
        >
          <Plus className="size-4" aria-hidden />
          Write
        </Button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={BookOpen}
            title={total === 0 ? "Nothing written yet" : "No entries match those filters"}
            description={
              total === 0
                ? "Record why you bought, what you expected, and what you would do differently. Six months from now it is the only record of what you were actually thinking."
                : "Try clearing the search or the type filter."
            }
            action={
              total === 0 ? (
                <Button
                  onClick={() => {
                    setEditing(undefined)
                    setDialogOpen(true)
                  }}
                  className="gap-2"
                >
                  <Plus className="size-4" aria-hidden />
                  Write the first entry
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="bg-card rounded-xl border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="bg-muted rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                      {JOURNAL_LABELS[entry.type]}
                    </span>
                    {entry.reason && (
                      <span className="text-muted-foreground text-xs">
                        {SELL_REASON_LABELS[entry.reason]}
                      </span>
                    )}
                    {entry.symbol && (
                      <Link
                        href={`/stocks/${entry.symbol}?market=${entry.market}`}
                        className="text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {entry.symbol}
                      </Link>
                    )}
                    {entry.symbol && (
                      <MarketBadge
                        market={toMarket(entry.market)}
                        currency={currencyOf(toMarket(entry.market))}
                      />
                    )}
                  </div>
                  <p className="font-medium">{entry.title}</p>
                </div>
                <time className="text-muted-foreground shrink-0 text-xs" dateTime={entry.entry_date}>
                  {formatDate(entry.entry_date, locale)}
                </time>
              </div>

              {/* Plain text, deliberately: rendered as a React text node and never parsed. */}
              {entry.content && (
                <p className="text-muted-foreground mt-2 text-sm whitespace-pre-wrap">
                  {entry.content}
                </p>
              )}

              <div className="mt-3 flex justify-end gap-1 border-t pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setEditing(entry)
                    setDialogOpen(true)
                  }}
                >
                  <Pencil className="size-3.5" aria-hidden />
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-loss gap-1.5"
                  disabled={remove.isPending}
                  onClick={() => {
                    if (confirm("Delete this entry?")) remove.mutate(entry)
                  }}
                >
                  {remove.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden />
                  )}
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}

      <JournalDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        portfolioId={portfolioId}
        entry={editing}
      />
    </div>
  )
}
