"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { MARKETS, currencyOf, marketOf, type MarketId } from "@/domain/market"

/**
 * Which exchange a symbol trades on.
 *
 * Every form that records an instrument needs this, because the market is what fixes the currency:
 * a price typed into a transaction form is 32 baht or 32 dollars depending on nothing else. The
 * currency is shown beside each option rather than asked for separately — deriving it removes the
 * possibility of the two disagreeing.
 */
export function MarketSelect({
  id,
  value,
  onChange,
  disabled,
  label = "Market",
}: {
  id: string
  value: MarketId
  onChange: (market: MarketId) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(next) => onChange(next as MarketId)} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {MARKETS.map((market) => (
            <SelectItem key={market} value={market}>
              {marketOf(market).label} · {currencyOf(market)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
