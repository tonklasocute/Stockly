"use client"

import { useState } from "react"
import { Bell, BellRing } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { AlertType } from "@/domain/alerts"
import type { Currency, MarketId } from "@/domain/market"
import { formatCurrency } from "@/lib/format"
import type { AlertRow } from "@/types/database"
import { AlertDialog } from "./alert-dialog"

/**
 * "Set alert" on a stock page, with a couple of sensible targets pre-filled from the current price.
 *
 * The suggestions are round numbers either side of the price — the thresholds people actually pick.
 * Existing alerts for this symbol are shown rather than hidden, so the button cannot be used to
 * create the same rule twice without noticing (the unique constraint would refuse it anyway).
 */
export function QuickAlert({
  symbol,
  market,
  currency,
  price,
  portfolioId,
  existing,
}: {
  symbol: string
  market: MarketId
  /** The instrument's own currency: a price alert's target is in the currency it is quoted in. */
  currency: Currency
  price: number | null
  portfolioId?: string
  existing: AlertRow[]
}) {
  const [open, setOpen] = useState(false)
  const [preset, setPreset] = useState<{ type: AlertType; target: number } | undefined>()

  const suggestions = price
    ? [
        {
          label: `Above ${formatCurrency(round(price * 1.05), currency)}`,
          type: "PRICE_ABOVE" as const,
          target: round(price * 1.05),
        },
        {
          label: `Below ${formatCurrency(round(price * 0.95), currency)}`,
          type: "PRICE_BELOW" as const,
          target: round(price * 0.95),
        },
      ]
    : []

  // Scoped to this venue: an alert on a SET ticker is not an alert on a US one that spells the same.
  const mine = existing.filter((a) => a.symbol === symbol && a.market === market)

  function open_(type?: AlertType, target?: number) {
    setPreset(type && target !== undefined ? { type, target } : undefined)
    setOpen(true)
  }

  return (
    <div className="space-y-3">
      {mine.length > 0 && (
        <ul className="text-muted-foreground space-y-1 text-sm">
          {mine.map((alert) => (
            <li key={alert.id} className="flex items-center gap-2">
              <BellRing className="size-3.5 shrink-0" aria-hidden />
              {alert.type === "PRICE_ABOVE" ? "Above" : alert.type === "PRICE_BELOW" ? "Below" : "Alert at"}{" "}
              {formatCurrency(Number(alert.target_value), currency)}
              <span className="text-xs">· {alert.enabled ? "active" : "disabled"}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <Button
            key={suggestion.label}
            variant="outline"
            size="sm"
            onClick={() => open_(suggestion.type, suggestion.target)}
          >
            {suggestion.label}
          </Button>
        ))}
        <Button variant="outline" size="sm" className="gap-2" onClick={() => open_()}>
          <Bell className="size-4" aria-hidden />
          {suggestions.length ? "Custom" : "Set alert"}
        </Button>
      </div>

      <AlertDialog
        open={open}
        onOpenChange={setOpen}
        portfolioId={portfolioId}
        defaultSymbol={symbol}
        defaultMarket={market}
        defaultType={preset?.type}
        defaultTarget={preset?.target}
      />
    </div>
  )
}

/** Round to a threshold a person would actually type: whole dollars, or 5s above $100. */
function round(value: number): number {
  if (value >= 100) return Math.round(value / 5) * 5
  if (value >= 10) return Math.round(value)
  return Math.round(value * 10) / 10
}
