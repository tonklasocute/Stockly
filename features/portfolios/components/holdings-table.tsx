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
import { MarketBadge } from "@/components/market-badge"
import { Delta, Percent } from "@/components/value"
import type { Currency } from "@/domain/market"
import type { Holding } from "@/domain/types"
import {
  formatCurrency,
  formatOptionalCurrency,
  formatOptionalPercent,
  formatQuantity,
} from "@/lib/format"

type SortKey = "value" | "return" | "pnl" | "symbol"

const SORT_LABELS: Record<SortKey, string> = {
  value: "Market value",
  return: "Return %",
  pnl: "Profit & loss",
  symbol: "Symbol",
}

/**
 * Sorting happens in the base currency, because that is the only scale on which a baht position and
 * a dollar position can be ordered. A holding with no rate has no place on that scale and sorts
 * last rather than as if it were worth nothing.
 */
const SORTS: Record<SortKey, (a: Holding, b: Holding) => number> = {
  value: (a, b) => (b.baseMarketValue ?? -1) - (a.baseMarketValue ?? -1),
  return: (a, b) => b.returnPct - a.returnPct,
  pnl: (a, b) => (b.baseUnrealizedPnl ?? -Infinity) - (a.baseUnrealizedPnl ?? -Infinity),
  symbol: (a, b) => a.symbol.localeCompare(b.symbol),
}

/** True once more than one currency is on screen — the trigger for showing the native column. */
function isMixed(holdings: readonly Holding[], base: Currency): boolean {
  return holdings.some((h) => h.currency !== base)
}

export function HoldingsTable({
  holdings,
  currency,
  names,
}: {
  holdings: Holding[]
  /** The portfolio's base currency: what every value column below is denominated in. */
  currency: Currency
  names: Record<string, string | undefined>
}) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("value")
  const mixed = isMixed(holdings, currency)

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
                  <Link href={`/stocks/${h.symbol}?market=${h.market}`} className="tap min-w-0 flex-col !items-start">
                    <p className="flex items-center gap-1.5 font-semibold underline-offset-4 hover:underline">
                      {h.symbol}
                      {mixed && <MarketBadge market={h.market} currency={h.currency} />}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {names[h.symbol] ?? `${formatQuantity(h.quantity)} shares`}
                    </p>
                  </Link>
                  <div className="text-right">
                    <p className="tabular font-semibold">
                      {formatOptionalCurrency(h.baseMarketValue, currency)}
                    </p>
                    {mixed && h.currency !== currency && (
                      <p className="text-muted-foreground tabular text-xs">
                        {formatCurrency(h.marketValue, h.currency)}
                      </p>
                    )}
                    {h.baseUnrealizedPnl === null ? (
                      <span className="text-muted-foreground text-xs">P&amp;L N/A</span>
                    ) : (
                      <Delta
                        value={h.baseUnrealizedPnl}
                        currency={currency}
                        percent={h.returnPct}
                      />
                    )}
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
                      {formatCurrency(h.averageCost, h.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd className="tabular text-foreground">
                      {formatCurrency(h.currentPrice, h.currency)}
                    </dd>
                  </div>
                  <div>
                    <dt>Weight</dt>
                    <dd className="tabular text-foreground">
                      {formatOptionalPercent(h.weight, { signed: false })}
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
                  {mixed && <TableHead className="text-right">Value (native)</TableHead>}
                  <TableHead className="text-right">Market value ({currency})</TableHead>
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
                        href={`/stocks/${h.symbol}?market=${h.market}`}
                        className="tap font-medium underline-offset-4 hover:underline"
                      >
                        {h.symbol}
                      </Link>
                      {mixed && <MarketBadge market={h.market} currency={h.currency} className="ml-2" />}
                      {names[h.symbol] && (
                        <span className="text-muted-foreground ml-2 text-xs">{names[h.symbol]}</span>
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatQuantity(h.quantity)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(h.averageCost, h.currency)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(h.currentPrice, h.currency)}
                    </TableCell>
                    {mixed && (
                      <TableCell className="tabular text-muted-foreground text-right">
                        {formatCurrency(h.marketValue, h.currency)}
                      </TableCell>
                    )}
                    <TableCell className="tabular text-right font-medium">
                      {formatOptionalCurrency(h.baseMarketValue, currency)}
                    </TableCell>
                    <TableCell className="text-right">
                      {h.baseUnrealizedPnl === null ? (
                        <span className="text-muted-foreground text-sm">N/A</span>
                      ) : (
                        <Delta value={h.baseUnrealizedPnl} currency={currency} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Percent value={h.returnPct} />
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground text-right">
                      {formatOptionalPercent(h.weight, { signed: false })}
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
