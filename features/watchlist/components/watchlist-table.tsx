"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Eye, Search, Trash2 } from "lucide-react"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/empty-state"
import { Percent } from "@/components/value"
import { apiFetch } from "@/lib/api-client"
import { formatCurrency, formatOptional } from "@/lib/format"
import type { Quote } from "@/services/market-data/types"
import type { WatchlistItemRow } from "@/types/database"

type SortKey = "added" | "symbol" | "change" | "score" | "rsi" | "rvol" | "adx"

const SORT_LABELS: Record<SortKey, string> = {
  added: "Recently added",
  symbol: "Symbol",
  change: "Biggest move",
  score: "Technical score",
  rsi: "RSI",
  rvol: "Relative volume",
  adx: "ADX",
}

/** A technical figure for one row, as of the last snapshot refresh. */
export type RowTechnicals = {
  rsi: number | null
  adx: number | null
  relativeVolume: number | null
  score: number | null
  trend: string
  stale: boolean
}

export function WatchlistTable({
  items,
  quotes,
  technicals = {},
}: {
  items: WatchlistItemRow[]
  /** Serialisable across the server boundary; a Map is not. */
  quotes: Record<string, Quote>
  technicals?: Record<string, RowTechnicals>
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("added")

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    const filtered = items.filter(
      (item) => !q || item.symbol.includes(q) || (item.name ?? "").toUpperCase().includes(q),
    )
    // Rows with no value for the chosen metric sort last, whatever the direction.
    const byMetric = (pick: (t: RowTechnicals | undefined) => number | null) => (a: WatchlistItemRow, b: WatchlistItemRow) => {
      const av = pick(technicals[a.symbol])
      const bv = pick(technicals[b.symbol])
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return bv - av
    }

    return [...filtered].sort((a, b) => {
      if (sort === "symbol") return a.symbol.localeCompare(b.symbol)
      if (sort === "change") {
        return Math.abs(quotes[b.symbol]?.changePct ?? 0) - Math.abs(quotes[a.symbol]?.changePct ?? 0)
      }
      if (sort === "score") return byMetric((t) => t?.score ?? null)(a, b)
      if (sort === "rsi") return byMetric((t) => t?.rsi ?? null)(a, b)
      if (sort === "rvol") return byMetric((t) => t?.relativeVolume ?? null)(a, b)
      if (sort === "adx") return byMetric((t) => t?.adx ?? null)(a, b)
      return b.created_at.localeCompare(a.created_at)
    })
  }, [items, query, sort, quotes, technicals])

  const remove = useMutation({
    mutationFn: (item: WatchlistItemRow) =>
      apiFetch(`/api/watchlist/${item.symbol}?market=${item.market}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Removed from your watchlist.")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  if (items.length === 0) {
    return (
      <div className="rounded-xl border">
        <EmptyState
          icon={Eye}
          title="Your watchlist is empty"
          description="Search for a stock and add it to start tracking it."
        />
      </div>
    )
  }

  const priceCell = (item: WatchlistItemRow) => {
    const quote = quotes[item.symbol]
    return (
      <span className="tabular font-medium">
        {formatOptional(quote?.price ?? null, (v) => formatCurrency(v, quote?.currency ?? "USD"))}
      </span>
    )
  }

  const changeCell = (item: WatchlistItemRow) => {
    const changePct = quotes[item.symbol]?.changePct
    return changePct === null || changePct === undefined ? (
      <span className="text-muted-foreground text-sm">N/A</span>
    ) : (
      <Percent value={changePct} />
    )
  }

  const removeButton = (item: WatchlistItemRow) => (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Remove ${item.symbol} from watchlist`}
      disabled={remove.isPending}
      onClick={() => remove.mutate(item)}
    >
      <Trash2 className="size-4" aria-hidden />
    </Button>
  )

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search watchlist"
            className="pl-9"
            aria-label="Search watchlist"
          />
        </div>
        <Select value={sort} onValueChange={(value) => setSort((value as SortKey) ?? "added")}>
          <SelectTrigger aria-label="Sort watchlist" className="w-40">
            <SelectValue>{(value) => SORT_LABELS[value as SortKey]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
              <SelectItem key={key} value={key}>
                {SORT_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState icon={Search} title="No matches" description={`Nothing matches “${query}”.`} />
        </div>
      ) : (
        <>
          <ul className="grid gap-2 lg:hidden">
            {visible.map((item) => (
              <li key={item.id} className="bg-card flex items-center gap-3 rounded-xl border p-3.5">
                <Link href={`/stocks/${item.symbol}`} className="tap min-w-0 flex-1 flex-col !items-start">
                  <span className="block font-semibold">{item.symbol}</span>
                  <span className="text-muted-foreground block truncate text-xs">
                    {item.name ?? item.exchange ?? "—"}
                  </span>
                </Link>
                <div className="text-right">
                  <div>{priceCell(item)}</div>
                  <div>{changeCell(item)}</div>
                </div>
                {removeButton(item)}
              </li>
            ))}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border lg:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Symbol</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Change</TableHead>
                  <TableHead className="text-right">RSI</TableHead>
                  <TableHead className="text-right">RVOL</TableHead>
                  <TableHead>Trend</TableHead>
                  <TableHead className="text-right">Target buy</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        href={`/stocks/${item.symbol}`}
                        className="tap font-medium underline-offset-4 hover:underline"
                      >
                        {item.symbol}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-xs truncate">
                      {item.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-right">{priceCell(item)}</TableCell>
                    <TableCell className="text-right">{changeCell(item)}</TableCell>
                    <TableCell className="tabular text-muted-foreground text-right">
                      {technicals[item.symbol]?.rsi?.toFixed(0) ?? "—"}
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground text-right">
                      {technicals[item.symbol]?.relativeVolume
                        ? `${technicals[item.symbol]!.relativeVolume!.toFixed(1)}×`
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs capitalize">
                      {/* A glyph as well as the word, so trend is never colour alone. */}
                      {technicals[item.symbol]
                        ? `${technicals[item.symbol]!.trend === "bullish" ? "▲" : technicals[item.symbol]!.trend === "bearish" ? "▼" : "■"} ${technicals[item.symbol]!.trend}`
                        : "—"}
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground text-right">
                      {formatOptional(item.target_price, (v) => formatCurrency(v))}
                    </TableCell>
                    <TableCell className="text-right">{removeButton(item)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
