"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import {
  ArrowLeftRight,
  ArrowUpDown,
  FileClock,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { JournalDialog } from "@/features/journal/components/journal-dialog"
import { CorrectionDialog } from "@/features/operations/components/correction-dialog"
import type { JournalRow } from "@/types/database"
import { currencyOf, toMarket } from "@/domain/market"
import { apiFetch } from "@/lib/api-client"
import { formatCurrency, formatDate, formatQuantity } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { TransactionRow } from "@/types/database"
import { TransactionDialog } from "./transaction-dialog"
import { useAppLocale } from "@/lib/i18n/locale"
import { useTranslations } from "next-intl"

type SortKey = "date-desc" | "date-asc" | "total-desc"

/* Keys, not words — resolved at the render site, like `NAV_ITEMS`. */
const SIDE_FILTERS = ["all", "buy", "sell"] as const
const SORT_KEYS: Record<SortKey, string> = {
  "date-desc": "sort.newest",
  "date-asc": "sort.oldest",
  "total-desc": "sort.largest",
}

// Renamed from `t` in phase 21: `t` is the translator everywhere else in this file.
function totalOf(row: TransactionRow) {
  return row.side === "buy" ? row.quantity * row.price + row.fee : row.quantity * row.price - row.fee
}

export function TransactionList({
  transactions,
  portfolioId,
  sellReviews = {},
}: {
  transactions: TransactionRow[]
  portfolioId: string
  /** Existing sell reviews keyed by transaction id, so the menu offers "edit" rather than "add". */
  sellReviews?: Record<string, JournalRow>
}) {
  const tc = useTranslations("common")
  const t = useTranslations("transactions")
  const tEnum = useTranslations("enums")
  const locale = useAppLocale()
  const router = useRouter()
  // A trade's amounts are in the currency of the venue it happened on, never the portfolio's: a
  // ฿32 price rendered as $32 is the single most damaging mistake this page could make.
  const currencyOfRow = (transaction: TransactionRow) => currencyOf(toMarket(transaction.market))
  const mixed = new Set(transactions.map((t) => t.market)).size > 1
  const [query, setQuery] = useState("")
  const [side, setSide] = useState<"all" | "buy" | "sell">("all")
  const [symbol, setSymbol] = useState("all")
  const [sort, setSort] = useState<SortKey>("date-desc")
  const [editing, setEditing] = useState<TransactionRow | undefined>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [reviewing, setReviewing] = useState<TransactionRow | undefined>()
  const [correcting, setCorrecting] = useState<TransactionRow | undefined>()
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)

  const symbols = useMemo(
    () => [...new Set(transactions.map((t) => t.symbol))].sort(),
    [transactions],
  )

  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    const filtered = transactions.filter(
      (t) =>
        (side === "all" || t.side === side) &&
        (symbol === "all" || t.symbol === symbol) &&
        (!q || t.symbol.includes(q) || (t.notes ?? "").toUpperCase().includes(q)),
    )
    const sorted = [...filtered]
    if (sort === "total-desc") sorted.sort((a, b) => totalOf(b) - totalOf(a))
    else
      sorted.sort((a, b) =>
        sort === "date-desc"
          ? b.trade_date.localeCompare(a.trade_date)
          : a.trade_date.localeCompare(b.trade_date),
      )
    return sorted
  }, [transactions, query, side, symbol, sort])

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/transactions/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("deleted"))
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  function openNew() {
    setEditing(undefined)
    setDialogOpen(true)
  }

  function openEdit(transaction: TransactionRow) {
    setEditing(transaction)
    setDialogOpen(true)
  }

  const rowActions = (transaction: TransactionRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={`Actions for ${transaction.symbol}`} />}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => openEdit(transaction)} className="gap-2">
          <Pencil className="size-4" aria-hidden />{tc("actions.edit")}</DropdownMenuItem>
        {/*
          Both paths are audited — a database trigger records the before and after of every write,
          and no route can opt out. Only this one carries *why*, which is the whole difference.
        */}
        <DropdownMenuItem
          onSelect={() => {
            setCorrecting(transaction)
            setCorrectionOpen(true)
          }}
          className="gap-2"
        >
          <FileClock className="size-4" aria-hidden />{t("rowActions.correct")}</DropdownMenuItem>
        {transaction.side === "sell" && (
          <DropdownMenuItem
            onSelect={() => {
              setReviewing(transaction)
              setReviewOpen(true)
            }}
            className="gap-2"
          >
            <NotebookPen className="size-4" aria-hidden />
            {sellReviews[transaction.id] ? "Edit sell reason" : "Why did you sell?"}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          className="gap-2"
          onSelect={() => {
            if (confirm(`Delete this ${transaction.side} of ${transaction.symbol}?`)) {
              remove.mutate(transaction.id)
            }
          }}
        >
          <Trash2 className="size-4" aria-hidden />{tc("actions.delete")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const sideBadge = (transaction: TransactionRow) => (
    <Badge
      variant="outline"
      className={cn(
        "capitalize",
        transaction.side === "buy" ? "border-gain/40 text-gain" : "border-loss/40 text-loss",
      )}
    >
      {transaction.side}
    </Badge>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("search.placeholder")}
            className="pl-9"
            aria-label={t("search.label")}
          />
        </div>

        <div className="grid grid-cols-3 gap-2 sm:flex sm:w-auto">
          <Select value={side} onValueChange={(value) => setSide((value as typeof side) ?? "all")}>
            <SelectTrigger aria-label={t("search.filterType")} className="sm:w-28">
              <SelectValue>
                {(value) =>
                  value === "all" ? t("search.allTypes") : tEnum(`transactionSide.${String(value)}`)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SIDE_FILTERS.map((value) => (
                <SelectItem key={value} value={value}>
                  {value === "all" ? t("search.allTypes") : tEnum(`transactionSide.${value}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={symbol} onValueChange={(value) => setSymbol(value ?? "all")}>
            <SelectTrigger aria-label={t("search.filterSymbol")} className="sm:w-32">
              <SelectValue>{(value) => (value === "all" ? t("search.allSymbols") : String(value))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("search.allSymbols")}</SelectItem>
              {symbols.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(value) => setSort((value as SortKey) ?? "date-desc")}>
            <SelectTrigger aria-label={t("search.sort")} className="sm:w-36">
              <ArrowUpDown className="size-3.5 opacity-60" aria-hidden />
              <SelectValue>{(value) => t(SORT_KEYS[value as SortKey])}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="date-desc">{t("sort.newest")}</SelectItem>
              <SelectItem value="date-asc">{t("sort.oldest")}</SelectItem>
              <SelectItem value="total-desc">{t("sort.largest")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button onClick={openNew} className="gap-2 max-sm:h-11 max-sm:w-full">
          <Plus className="size-4" aria-hidden />{tc("actions.add")}</Button>
      </div>

      {transactions.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={ArrowLeftRight}
            title={t("empty.title")}
            description={t("empty.body")}
            action={
              <Button onClick={openNew} className="gap-2">
                <Plus className="size-4" aria-hidden />{t("add")}</Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Search}
            title={t("noMatches.title")}
            description={t("noMatches.body")}
          />
        </div>
      ) : (
        <>
          {/* Mobile: cards, because eight columns cannot be read at 390px. */}
          <ul className="grid gap-2 lg:hidden">
            {visible.map((transaction) => (
              <li key={transaction.id} className="bg-card rounded-xl border p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{transaction.symbol}</span>
                      {mixed && (
                        <MarketBadge
                          market={toMarket(transaction.market)}
                          currency={currencyOfRow(transaction)}
                        />
                      )}
                      {sideBadge(transaction)}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {formatDate(transaction.trade_date, locale)}
                    </p>
                  </div>
                  <div className="flex items-start gap-1">
                    <span className="tabular text-right font-semibold">
                      {formatCurrency(totalOf(transaction), currencyOfRow(transaction))}
                    </span>
                    {rowActions(transaction)}
                  </div>
                </div>
                <dl className="text-muted-foreground mt-2.5 grid grid-cols-3 gap-2 border-t pt-2.5 text-xs">
                  <div>
                    <dt>{t("columns.quantity")}</dt>
                    <dd className="tabular text-foreground">
                      {formatQuantity(transaction.quantity)}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("columns.price")}</dt>
                    <dd className="tabular text-foreground">
                      {formatCurrency(transaction.price, currencyOfRow(transaction))}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("columns.fee")}</dt>
                    <dd className="tabular text-foreground">
                      {formatCurrency(transaction.fee, currencyOfRow(transaction))}
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
                  <TableHead>{t("columns.date")}</TableHead>
                  <TableHead>{t("columns.type")}</TableHead>
                  <TableHead>{t("columns.symbol")}</TableHead>
                  <TableHead className="text-right">{t("columns.quantity")}</TableHead>
                  <TableHead className="text-right">{t("columns.price")}</TableHead>
                  <TableHead className="text-right">{t("columns.fee")}</TableHead>
                  <TableHead className="text-right">{t("columns.total")}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((transaction) => (
                  <TableRow key={transaction.id}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDate(transaction.trade_date, locale)}
                    </TableCell>
                    <TableCell>{sideBadge(transaction)}</TableCell>
                    <TableCell className="font-medium">
                      {transaction.symbol}
                      {mixed && (
                        <MarketBadge
                          market={toMarket(transaction.market)}
                          currency={currencyOfRow(transaction)}
                          className="ml-2"
                        />
                      )}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatQuantity(transaction.quantity)}
                    </TableCell>
                    <TableCell className="tabular text-right">
                      {formatCurrency(transaction.price, currencyOfRow(transaction))}
                    </TableCell>
                    <TableCell className="tabular text-muted-foreground text-right">
                      {formatCurrency(transaction.fee, currencyOfRow(transaction))}
                    </TableCell>
                    <TableCell className="tabular text-right font-medium">
                      {formatCurrency(totalOf(transaction), currencyOfRow(transaction))}
                    </TableCell>
                    <TableCell className="text-right">{rowActions(transaction)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <TransactionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        portfolioId={portfolioId}
        transaction={editing}
      />

      {/*
        A sell review records *why*, never how much: the realised profit or loss on this trade is
        computed by the engine from the transaction itself, and a figure typed here would be a
        second source of truth for the number the whole application exists to get right.
      */}
      {/*
        Mounted per transaction and unmounted on close, so the form always starts from the stored
        row without an effect synchronising props into state.
      */}
      {correcting && correctionOpen && (
        <CorrectionDialog
          key={correcting.id}
          open
          onOpenChange={(next) => {
            setCorrectionOpen(next)
            if (!next) setCorrecting(undefined)
          }}
          transaction={correcting}
        />
      )}

      {reviewing && (
        <JournalDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          portfolioId={portfolioId}
          entry={sellReviews[reviewing.id]}
          defaults={{
            symbol: reviewing.symbol,
            market: toMarket(reviewing.market),
            type: "SELL_REASON",
            transactionId: reviewing.id,
            title: `Sold ${reviewing.symbol}`,
          }}
        />
      )}
    </div>
  )
}
