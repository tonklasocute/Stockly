"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Scale } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { parseCsv } from "@/lib/csv"
import { CURRENCIES, MARKETS, isCurrency, isMarket, normalizeSymbol } from "@/domain/market"
import { apiFetch } from "@/lib/api-client"
import type { Currency, MarketId } from "@/domain/market"

/**
 * Starting a reconciliation.
 *
 * Two text boxes, deliberately. A file upload would need a second parser, a size limit, a MIME
 * check and a path through the server for bytes Stockly does not want to hold — and a statement's
 * holdings page is a dozen lines somebody can copy. The CSV reader is the one already used by
 * import (`lib/csv.ts`), so a broker's semicolons and quoted fields behave identically here.
 *
 * Nothing is repaired. A line that cannot be read is listed as skipped, with its number, rather
 * than guessed at — a mis-parsed quantity would be reported to the user as *their* discrepancy.
 */

type ParsedPosition = { symbol: string; market: MarketId; quantity: number; averageCost: number | null; currency: Currency }
type ParsedBalance = { currency: Currency; balance: number }

/** A number as a statement writes it: thousands separators, and parentheses for a negative. */
function toNumber(raw: string): number | null {
  const text = raw.trim().replace(/[\s,]/g, "")
  if (!text) return null
  const negative = /^\(.*\)$/.test(text)
  const value = Number(negative ? text.slice(1, -1) : text)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

function parsePositions(text: string): { rows: ParsedPosition[]; skipped: number[] } {
  const rows: ParsedPosition[] = []
  const skipped: number[] = []

  parseCsv(text).rows.forEach((cells, index) => {
    const lineNumber = index + 1
    const [rawSymbol, rawMarket, rawQuantity, rawCost, rawCurrency] = cells.map((c) => c?.trim() ?? "")
    // A header line looks exactly like an unreadable data line, and is skipped the same way.
    if (!rawSymbol || !isMarket(rawMarket)) {
      if (cells.some((c) => c?.trim())) skipped.push(lineNumber)
      return
    }
    const quantity = toNumber(rawQuantity)
    if (quantity === null || quantity < 0) {
      skipped.push(lineNumber)
      return
    }
    // An absent cost stays null. A zero here would report the position as a total mismatch.
    const averageCost = rawCost ? toNumber(rawCost) : null
    const currency = isCurrency(rawCurrency) ? rawCurrency : null

    rows.push({
      symbol: normalizeSymbol(rawSymbol),
      market: rawMarket,
      quantity,
      averageCost: averageCost !== null && averageCost >= 0 ? averageCost : null,
      // Falls back to the market's own currency, which is where an instrument's currency comes
      // from everywhere else in Stockly.
      currency: currency ?? (rawMarket === "SET" ? "THB" : "USD"),
    })
  })

  return { rows, skipped }
}

function parseBalances(text: string): { rows: ParsedBalance[]; skipped: number[] } {
  const rows: ParsedBalance[] = []
  const skipped: number[] = []
  const seen = new Set<Currency>()

  parseCsv(text).rows.forEach((cells, index) => {
    const [rawCurrency, rawBalance] = cells.map((c) => c?.trim() ?? "")
    if (!rawCurrency) return
    const balance = toNumber(rawBalance)
    // One currency cannot hold two balances; a second would silently win.
    if (!isCurrency(rawCurrency) || balance === null || seen.has(rawCurrency)) {
      skipped.push(index + 1)
      return
    }
    seen.add(rawCurrency)
    rows.push({ currency: rawCurrency, balance })
  })

  return { rows, skipped }
}

export function ReconcileForm({ portfolioId }: { portfolioId: string }) {
  const router = useRouter()
  const [sourceLabel, setSourceLabel] = useState("")
  const [periodStart, setPeriodStart] = useState("")
  const [periodEnd, setPeriodEnd] = useState("")
  const [positionsText, setPositionsText] = useState("")
  const [balancesText, setBalancesText] = useState("")

  const positions = useMemo(() => parsePositions(positionsText), [positionsText])
  const balances = useMemo(() => parseBalances(balancesText), [balancesText])
  const nothingToCompare = positions.rows.length === 0 && balances.rows.length === 0

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<{ run: { id: string } }>("/api/reconciliation", {
        method: "POST",
        body: JSON.stringify({
          portfolioId,
          sourceLabel: sourceLabel.trim() || "Broker statement",
          periodStart: periodStart || null,
          periodEnd: periodEnd || null,
          positions: positions.rows,
          balances: balances.rows,
        }),
      }),
    onSuccess: () => {
      toast.success("Comparison finished. Nothing was changed.")
      setPositionsText("")
      setBalancesText("")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (!nothingToCompare) mutation.mutate()
      }}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-3">
          <Label htmlFor="rec-label">Statement</Label>
          <Input
            id="rec-label"
            value={sourceLabel}
            onChange={(event) => setSourceLabel(event.target.value)}
            placeholder="Broker statement — August"
            maxLength={120}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rec-from">Period from</Label>
          <Input id="rec-from" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="rec-to">Period to</Label>
          <Input id="rec-to" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="rec-positions">Positions</Label>
        <p className="text-muted-foreground text-xs">
          One per line: symbol, market ({MARKETS.join(" or ")}), quantity, average cost, currency.
          Leave the cost blank if the statement does not show one — it will read as unknown, not zero.
        </p>
        <textarea
          id="rec-positions"
          value={positionsText}
          onChange={(event) => setPositionsText(event.target.value)}
          rows={6}
          spellCheck={false}
          aria-describedby="rec-positions-summary"
          className="border-input bg-background focus-visible:ring-ring w-full rounded-md border p-3 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
          placeholder={"AAPL,US,100,150.25,USD\nPTT,SET,500,35,THB"}
        />
        <p id="rec-positions-summary" className="text-muted-foreground text-xs" role="status">
          {positions.rows.length} position{positions.rows.length === 1 ? "" : "s"} read
          {positions.skipped.length > 0
            ? ` · ${positions.skipped.length} line${positions.skipped.length === 1 ? "" : "s"} skipped (${positions.skipped.slice(0, 5).join(", ")})`
            : ""}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="rec-balances">Cash balances</Label>
        <p className="text-muted-foreground text-xs">
          One per line: currency ({CURRENCIES.slice(0, 2).join(", ")}…), balance. Each currency is
          compared against its own ledger — nothing is converted.
        </p>
        <textarea
          id="rec-balances"
          value={balancesText}
          onChange={(event) => setBalancesText(event.target.value)}
          rows={3}
          spellCheck={false}
          aria-describedby="rec-balances-summary"
          className="border-input bg-background focus-visible:ring-ring w-full rounded-md border p-3 font-mono text-xs focus-visible:ring-2 focus-visible:outline-none"
          placeholder={"USD,1250.40\nTHB,32000"}
        />
        <p id="rec-balances-summary" className="text-muted-foreground text-xs" role="status">
          {balances.rows.length} balance{balances.rows.length === 1 ? "" : "s"} read
          {balances.skipped.length > 0
            ? ` · ${balances.skipped.length} line${balances.skipped.length === 1 ? "" : "s"} skipped`
            : ""}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={nothingToCompare || mutation.isPending}>
          {mutation.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Scale className="size-4" aria-hidden />
          )}
          Compare
        </Button>
        <p className="text-muted-foreground text-xs">
          This compares and records what it finds. It changes no transaction, holding or balance.
        </p>
      </div>
    </form>
  )
}
