"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation } from "@tanstack/react-query"
import { Loader2, Split, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { MarketSelect } from "@/components/market-select"
import { previewShareAdjustment, ratioOf } from "@/domain/corporate-actions"
import { currencyOf, symbolKey, toMarket, type MarketId } from "@/domain/market"
import { apiFetch } from "@/lib/api-client"
import { formatCurrency, formatDate, formatQuantity } from "@/lib/format"
import type { Holding } from "@/domain/types"
import type { ShareAdjustmentRow } from "@/types/database"
import { useAppLocale } from "@/lib/i18n/locale"
import { useTranslations } from "next-intl"

/**
 * Recording a split, and undoing one.
 *
 * The preview is computed with the very same function the engine uses — `previewShareAdjustment`
 * from `domain/corporate-actions.ts` — so what the user confirms is arithmetically what happens.
 * A separately-written preview can be wrong about the thing it is previewing.
 *
 * Two things are stated on screen because they are what makes this safe: the invested value does
 * not move, and the transactions are not rewritten. Removing the row restores every figure.
 */
export function AdjustmentsPanel({
  portfolioId,
  holdings,
  adjustments,
}: {
  portfolioId: string
  holdings: Holding[]
  adjustments: ShareAdjustmentRow[]
}) {
  const to = useTranslations("operations")
  const locale = useAppLocale()
  const router = useRouter()
  const [symbol, setSymbol] = useState("")
  const [market, setMarket] = useState<MarketId>("US")
  const [numerator, setNumerator] = useState("2")
  const [denominator, setDenominator] = useState("1")
  const [effectiveDate, setEffectiveDate] = useState("")

  const held = holdings.find((h) => symbolKey(h.symbol, h.market) === symbolKey(symbol.toUpperCase(), market))
  const ratio = { numerator: Number(numerator), denominator: Number(denominator) }
  const valid =
    Number.isFinite(ratio.numerator) &&
    Number.isFinite(ratio.denominator) &&
    ratio.numerator > 0 &&
    ratio.denominator > 0 &&
    ratio.numerator !== ratio.denominator

  const preview = held && valid ? previewShareAdjustment(held, ratio) : null

  const create = useMutation({
    mutationFn: () =>
      apiFetch("/api/adjustments", {
        method: "POST",
        body: JSON.stringify({
          portfolioId,
          symbol: symbol.toUpperCase(),
          market,
          effectiveDate,
          numerator: ratio.numerator,
          denominator: ratio.denominator,
        }),
      }),
    onSuccess: () => {
      toast.success(to("adjustments.recorded"))
      setSymbol("")
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/adjustments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(to("adjustments.removed"))
      router.refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return (
    <div className="space-y-5">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (preview && effectiveDate) create.mutate()
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="adj-symbol">{to("adjustments.symbol")}</Label>
            <Input
              id="adj-symbol"
              value={symbol}
              onChange={(event) => setSymbol(event.target.value)}
              placeholder="AAPL"
              maxLength={20}
              autoCapitalize="characters"
            />
          </div>
          {/* MarketSelect renders its own label, so there is no second one here. */}
          <MarketSelect id="adj-market" value={market} onChange={setMarket} />
          <div className="space-y-2">
            <Label htmlFor="adj-date">{to("adjustments.effectiveDate")}</Label>
            <Input
              id="adj-date"
              type="date"
              value={effectiveDate}
              onChange={(event) => setEffectiveDate(event.target.value)}
              aria-describedby="adj-date-help"
            />
            <p id="adj-date-help" className="text-muted-foreground text-xs">{to("adjustments.effectiveDateHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="adj-numerator">{to("adjustments.ratio")}</Label>
            <div className="flex items-center gap-2">
              <Input
                id="adj-numerator"
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                className="tabular"
                value={numerator}
                onChange={(event) => setNumerator(event.target.value)}
              />
              <span aria-hidden>:</span>
              <Input
                aria-label={to("adjustments.ratioDenominator")}
                type="number"
                inputMode="decimal"
                min={0}
                step="any"
                className="tabular"
                value={denominator}
                onChange={(event) => setDenominator(event.target.value)}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              {valid
                ? ratioOf(ratio) > 1
                  ? `${numerator}-for-${denominator} split — more shares, lower price.`
                  : `${numerator}-for-${denominator} reverse split — fewer shares, higher price.`
                : "A ratio needs two different positive numbers."}
            </p>
          </div>
        </div>

        {symbol && !held ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">
            You hold no {symbol.toUpperCase()} on {market}. A split can only be applied to a position
            that exists.
          </p>
        ) : null}

        {preview && held ? (
          <div className="bg-muted/40 space-y-2 rounded-lg border p-3 text-sm">
            <p className="font-medium">{to("adjustments.whatChanges")}</p>
            <dl className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">
              <div>
                <dt>{to("adjustments.shares")}</dt>
                <dd className="text-foreground tabular">
                  {formatQuantity(preview.quantityBefore)} → {formatQuantity(preview.quantityAfter)}
                </dd>
              </div>
              <div>
                <dt>{to("adjustments.averageCost")}</dt>
                <dd className="text-foreground tabular">
                  {formatCurrency(preview.averageCostBefore, currencyOf(held.market))} →{" "}
                  {formatCurrency(preview.averageCostAfter, currencyOf(held.market))}
                </dd>
              </div>
              <div>
                <dt>{to("adjustments.investedValue")}</dt>
                <dd className="text-foreground tabular">
                  {formatCurrency(preview.investedValue, currencyOf(held.market))} · unchanged
                </dd>
              </div>
            </dl>
            {preview.fractionalShares > 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                This leaves {formatQuantity(preview.fractionalShares)} of a share. Stockly keeps the
                fraction rather than rounding it away. If your broker paid cash in lieu, record that
                sale as a transaction.
              </p>
            ) : null}
            <p className="text-muted-foreground text-xs">{to("adjustments.notRewritten")}</p>
          </div>
        ) : null}

        <Button type="submit" disabled={!preview || !effectiveDate || create.isPending}>
          {create.isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Split className="size-4" aria-hidden />
          )}
          Record split
        </Button>
      </form>

      {adjustments.length > 0 ? (
        <ul className="divide-y border-t pt-2">
          {adjustments.map((adjustment) => (
            <li key={adjustment.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="font-medium">{adjustment.symbol}</span>
              <span className="text-muted-foreground text-xs">
                {toMarket(adjustment.market)} · {adjustment.numerator}:{adjustment.denominator} ·
                from {formatDate(adjustment.effective_date, locale)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto"
                disabled={remove.isPending}
                onClick={() => remove.mutate(adjustment.id)}
              >
                <Trash2 className="size-4" aria-hidden />
                <span className="sr-only sm:not-sr-only">{to("adjustments.remove")}</span>
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
