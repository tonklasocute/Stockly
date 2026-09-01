"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Search, Wallet } from "lucide-react"
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
import { Delta, Percent } from "@/components/value"
import type { Holding } from "@/domain/types"
import { formatCurrency, formatPercent, formatQuantity } from "@/lib/format"

type SortKey = "value" | "return" | "pnl" | "symbol"

const SORT_LABELS: Record<SortKey, string> = {
  value: "Market value",
  return: "Return %",
  pnl: "Profit & loss",
  symbol: "Symbol",
}

const SORTS: Record<SortKey, (a: Holding, b: Holding) => number> = {
  value: (a, b) => b.marketValue - a.marketValue,
  return: (a, b) => b.returnPct - a.returnPct,
  pnl: (a, b) => b.unrealizedPnl - a.unrealizedPnl,
  symbol: (a, b) => a.symbol.localeCompare(b.symbol),
}

export function HoldingsTable({
  holdings,
  currency,
  names,
}: {
  holdings: Holding[]
  currency: string
  names: Record<string, string | undefined>
}) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("value")

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    return holdings
      .filter((h) => !q || h.symbol.includes(q) || (names[h.symbol] ?? "").toUpperCase().includes(q))
      .sort(SORTS[sort])
  }, [holdings, query, sort, names])

  if (holdings.length === 0) {
    return (
      <div className="rounded-xl border">
        <EmptyState
          icon={Wallet}
          title="No open positions"
          description="Once you record a buy, your holdings and their cost basis appear here."
        />
      </div>
    )
  }

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
            placeholder="Search holdings"
            className="pl-9"
            aria-label="Search holdings"
          />
        </div>
        <Select value={sort} onValueChange={(value) => setSort((value as SortKey) ?? "value")}>
          <SelectTrigger aria-label="Sort holdings" className="w-36">
            <SelectValue>{(value) => SORT_LABELS[value as SortKey]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="value">Market value</SelectItem>
            <SelectItem value="return">Return %</SelectItem>
            <SelectItem value="pnl">Profit &amp; loss</SelectItem>
            <SelectItem value="symbol">Symbol</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState icon={Search} title="No matches" description={`Nothing matches "${query}".`} />
        </div>
      ) : (
        <>
          <ul className="grid gap-2 lg:hidden">
            {visible.map((h) => (
              <li key={h.symbol} className="bg-card rounded-xl border p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/stocks/${h.symbol}`} className="tap min-w-0 flex-col !items-start">
                    <p className="font-semibold underline-offset-4 hover:underline">{h.symbol}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {names[h.symbol] ?? `${formatQuantity(h.quantity)} shares`}
                    </p>
                  </Link>
                  <div className="text-right">
                    <p className="tabular font-semibold">
                      {formatCurrency(h.marketValue, currency)}
                    </p>
                    <Delta value={h.unrealizedPnl} currency={currency} percent={h.returnPct} />
                  </div>
                </div>
                <dl className="text-muted-foreground mt-2.5 grid grid-cols-4 gap-2 border-t pt-2.5 text-xs">
                  <div>
                    <dt>Qty</dt>
                    <dd className="tabular text-foreground">{formatQuantity(h.quantity)}</dd>
                  </div>
                  <div>
                    <dt>Avg cost</dt>
                    <dd className="tabular text-foreground">
                      {formatCurrency(h.averageCost, currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd className="tabular text-foreground">
                      {formatCurrency(h.currentPrice, currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Weight</dt>
                    <dd className="tabular text-foreground">
                      {formatPercent(h.weight, { signed: false })}
                    </dd>
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
                  <TableHead className="text-right">Quantity</TableHead>
                  <TableHead className="text-right">Avg cost</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Market value</TableHead>
                  <TableHead className="text-right">P&amp;L</TableHead>
                  <TableHead className="text-right">Return</TableHead>
                  <TableHead className="text-right">Weight</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((h) => (
                  <TableRow key={h.symbol}>
                    <TableCell>
                      <Link
                        href={`/stocks/${h.symbol}`}
                        className="tap font-medium underline-offset-4 hover:underline"
                      >
                        {h.symbol}
                      </Link>
                      {names[h.symbol] && (
                        <span className="text-muted-foreground ml-2 text-xs">{names[h.symbol]}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatQuantity(h.quantity)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(h.averageCost, currency)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(h.currentPrice, currency)}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {formatCurrency(h.marketValue, currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Delta value={h.unrealizedPnl} currency={currency} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Percent value={h.returnPct} />
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground text-right">
                      {formatPercent(h.weight, { signed: false })}
                    </TableCell>
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
