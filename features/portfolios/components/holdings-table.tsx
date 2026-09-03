"use client"

import { useCallback, useMemo, useState } from "react"
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
import {
  DENSITY_CLASSES,
  GROUPING_LABELS,
  GROUPINGS,
  UNGROUPED,
  type Density,
  type Grouping,
} from "@/domain/personalization"
import { TAG_CLASSES } from "@/features/personalization/tag-colors"
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

/**
 * A position's tags.
 *
 * Colour never carries the meaning on its own — the name is always beside it — so the palette is a
 * way to scan, not a code to decipher.
 */
function TagChips({ tags }: { tags: readonly HoldingTag[] }) {
  if (tags.length === 0) return null
  return (
    <ul className="mt-2 flex flex-wrap gap-1">
      {tags.map((tag) => (
        <li
          key={tag.id}
          className={`rounded-full border px-2 py-0.5 text-[11px] ${TAG_CLASSES[tag.color] ?? TAG_CLASSES.slate}`}
        >
          {tag.name}
        </li>
      ))}
    </ul>
  )
}

/** True once more than one currency is on screen — the trigger for showing the native column. */
function isMixed(holdings: readonly Holding[], base: Currency): boolean {
  return holdings.some((h) => h.currency !== base)
}

export type HoldingTag = { id: string; name: string; color: string }

export function HoldingsTable({
  holdings,
  currency,
  names,
  density = "comfortable",
  tags = {},
}: {
  holdings: Holding[]
  /** The portfolio's base currency: what every value column below is denominated in. */
  currency: Currency
  names: Record<string, string | undefined>
  /** Row padding. Defaults to what the table always did, so nothing changes for anyone who has not chosen. */
  density?: Density
  /** Tags for each position, keyed by `market:symbol`. Labels only — never an input to a figure. */
  tags?: Record<string, HoldingTag[]>
}) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("value")
  const [grouping, setGrouping] = useState<Grouping>("none")
  const mixed = isMixed(holdings, currency)
  const pad = DENSITY_CLASSES[density]
  const tagsFor = useCallback(
    (h: Holding): HoldingTag[] => tags[`${h.market}:${h.symbol}`] ?? [],
    [tags],
  )

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    return holdings
      .filter((h) => !q || h.symbol.includes(q) || (names[h.symbol] ?? "").toUpperCase().includes(q))
      .sort(SORTS[sort])
  }, [holdings, query, sort, names])

  /**
   * Grouped, when the user asked for it.
   *
   * A position with several tags appears under each of them, which is what a tag means. A position
   * with none lands in **Ungrouped**, which is always present and always last — never omitted, and
   * never guessed at from the symbol.
   */
  const groups = useMemo(() => {
    if (grouping === "none") return [{ key: "all", label: "", rows: visible }]

    const buckets = new Map<string, Holding[]>()
    for (const holding of visible) {
      const keys =
        grouping === "market"
          ? [holding.market]
          : grouping === "tag"
            ? tagsFor(holding).map((t) => t.name)
            : []
      const placed = keys.length > 0 ? keys : [UNGROUPED]
      for (const key of placed) {
        const bucket = buckets.get(key)
        if (bucket) bucket.push(holding)
        else buckets.set(key, [holding])
      }
    }

    return [...buckets.entries()]
      .map(([key, rows]) => ({ key, label: key, rows }))
      .sort((a, b) => (a.key === UNGROUPED ? 1 : b.key === UNGROUPED ? -1 : a.key.localeCompare(b.key)))
  }, [visible, grouping, tagsFor])

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
        <Select
          value={grouping}
          onValueChange={(value) => setGrouping((value as Grouping) ?? "none")}
        >
          <SelectTrigger aria-label="Group holdings" className="w-32">
            <SelectValue>{(value) => GROUPING_LABELS[value as Grouping]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {/* Sector grouping needs provider metadata the table is not given, so it is offered
                where that data exists (the analytics page) and not here. */}
            {GROUPINGS.filter((g) => g !== "sector").map((g) => (
              <SelectItem key={g} value={g}>
                {GROUPING_LABELS[g]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          <div className="grid gap-4 lg:hidden">
            {groups.map((group) => (
              <section key={group.key} className="space-y-2">
                {group.label ? (
                  <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                    {group.label} · {group.rows.length}
                  </h3>
                ) : null}
                <ul className="grid gap-2">
            {group.rows.map((h) => (
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
                <TagChips tags={tagsFor(h)} />
              </li>
            ))}
                </ul>
              </section>
            ))}
          </div>

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
                  <TableHead>Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.flatMap((group) => [
                  ...(group.label
                    ? [
                        <TableRow key={`group-${group.key}`} className="hover:bg-transparent">
                          <TableCell
                            colSpan={mixed ? 10 : 9}
                            className="text-muted-foreground bg-muted/40 py-1.5 text-xs font-medium tracking-wide uppercase"
                          >
                            {group.label} · {group.rows.length}
                          </TableCell>
                        </TableRow>,
                      ]
                    : []),
                  ...group.rows.map((h) => (
                  <TableRow key={`${group.key}-${h.symbol}`} className={pad.row}>
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
                    <TableCell>
                      <TagChips tags={tagsFor(h)} />
                    </TableCell>
                  </TableRow>
                  )),
                ])}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}
