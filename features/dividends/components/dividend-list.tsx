"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Coins, MoreHorizontal, Pencil, Plus, Search, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { EmptyState } from "@/components/empty-state"
import { dividendAmounts } from "@/domain/dividends"
import { apiFetch } from "@/lib/api-client"
import { formatCurrency, formatDate, formatQuantity } from "@/lib/format"
import type { DividendRow } from "@/types/database"
import { DividendDialog } from "./dividend-dialog"
import { useAppLocale } from "@/lib/i18n/locale"
import { useTranslations } from "next-intl"

const amountsOf = (row: DividendRow) =>
  dividendAmounts({
    shares: row.shares,
    dividendPerShare: row.dividend_per_share,
    tax: row.tax,
    fee: row.fee,
  })

export function DividendList({
  dividends,
  portfolioId,
  currency,
}: {
  dividends: DividendRow[]
  portfolioId: string
  currency: string
}) {
  const t = useTranslations("dividends")
  const tc = useTranslations("common")
  const locale = useAppLocale()
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<DividendRow | undefined>()
  const [dialogOpen, setDialogOpen] = useState(false)

  // Filtering is client-side within the current page; the page itself comes from the server.
  const visible = useMemo(() => {
    const q = query.trim().toUpperCase()
    return dividends.filter(
      (d) => !q || d.symbol.includes(q) || (d.notes ?? "").toUpperCase().includes(q),
    )
  }, [dividends, query])

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/dividends/${id}`, { method: "DELETE" }),
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

  const actions = (row: DividendRow) => (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label={`Actions for ${row.symbol}`} />}
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            setEditing(row)
            setDialogOpen(true)
          }}
          className="gap-2"
        >
          <Pencil className="size-4" aria-hidden />{tc("actions.edit")}</DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          className="gap-2"
          onSelect={() => {
            if (confirm(`Delete the ${row.symbol} dividend from ${row.payment_date}?`)) {
              remove.mutate(row.id)
            }
          }}
        >
          <Trash2 className="size-4" aria-hidden />{tc("actions.delete")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
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
        <Button onClick={openNew} className="gap-2 max-sm:h-11 max-sm:w-full">
          <Plus className="size-4" aria-hidden />{t("record")}</Button>
      </div>

      {dividends.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Coins}
            title={t("empty.title")}
            description={t("empty.body")}
            action={
              <Button onClick={openNew} className="gap-2 max-sm:h-11">
                <Plus className="size-4" aria-hidden />{t("record")}</Button>
            }
          />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState icon={Search} title={t("noMatches")} description={`Nothing matches “${query}”.`} />
        </div>
      ) : (
        <>
          <ul className="grid gap-2 lg:hidden">
            {visible.map((row) => {
              const amounts = amountsOf(row)
              return (
                <li key={row.id} className="bg-card rounded-xl border p-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold">{row.symbol}</p>
                      <p className="text-muted-foreground text-xs">{formatDate(row.payment_date, locale)}</p>
                    </div>
                    <div className="flex items-start gap-1">
                      <span className="tabular font-semibold">
                        {formatCurrency(amounts.net, currency)}
                      </span>
                      {actions(row)}
                    </div>
                  </div>
                  <dl className="text-muted-foreground mt-2.5 grid grid-cols-3 gap-2 border-t pt-2.5 text-xs">
                    <div>
                      <dt>{t("columns.shares")}</dt>
                      <dd className="tabular text-foreground">{formatQuantity(row.shares)}</dd>
                    </div>
                    <div>
                      <dt>{t("columns.perShare")}</dt>
                      <dd className="tabular text-foreground">
                        {formatCurrency(row.dividend_per_share, currency, 4)}
                      </dd>
                    </div>
                    <div>
                      <dt>{t("columns.gross")}</dt>
                      <dd className="tabular text-foreground">
                        {formatCurrency(amounts.gross, currency)}
                      </dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ul>

          <div className="hidden overflow-hidden rounded-xl border lg:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{t("columns.date")}</TableHead>
                  <TableHead>{t("columns.symbol")}</TableHead>
                  <TableHead className="text-right">{t("columns.shares")}</TableHead>
                  <TableHead className="text-right">{t("columns.perShare")}</TableHead>
                  <TableHead className="text-right">{t("columns.gross")}</TableHead>
                  <TableHead className="text-right">{t("columns.tax")}</TableHead>
                  <TableHead className="text-right">{t("columns.fee")}</TableHead>
                  <TableHead className="text-right">{t("columns.net")}</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => {
                  const amounts = amountsOf(row)
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(row.payment_date, locale)}
                      </TableCell>
                      <TableCell className="font-medium">{row.symbol}</TableCell>
                      <TableCell className="tabular text-right">
                        {formatQuantity(row.shares)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatCurrency(row.dividend_per_share, currency, 4)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatCurrency(amounts.gross, currency)}
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground text-right">
                        {formatCurrency(amounts.tax, currency)}
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground text-right">
                        {formatCurrency(amounts.fee, currency)}
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">
                        {formatCurrency(amounts.net, currency)}
                      </TableCell>
                      <TableCell className="text-right">{actions(row)}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <DividendDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        portfolioId={portfolioId}
        currency={currency}
        dividend={editing}
      />
    </div>
  )
}
