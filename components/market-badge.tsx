import { cn } from "@/lib/utils"
import { formatFxRate } from "@/lib/format"
import type { Currency, MarketId } from "@/domain/market"
import type { HoldingFx } from "@/domain/types"

/**
 * "SET · THB" — which venue an instrument trades on and what its prices are in.
 *
 * Small, quiet, and always present rather than only shown for the non-default market: a user whose
 * portfolio is entirely US should still see "US · USD" so that the day a Thai holding appears, the
 * difference reads as a difference and not as a new decoration.
 */
export function MarketBadge({
  market,
  currency,
  className,
}: {
  market: MarketId
  currency: Currency
  className?: string
}) {
  return (
    <span
      className={cn(
        "text-muted-foreground bg-muted/60 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
        className,
      )}
    >
      {market} · {currency}
    </span>
  )
}

/**
 * The rate a figure was translated at, and how old it is.
 *
 * Shown wherever a converted amount is, because a converted amount without its rate is a number the
 * user cannot check. Renders nothing for the identity conversion — there is no rate to disclose
 * when the currencies already match.
 */
export function FxNote({
  from,
  to,
  fx,
  className,
}: {
  from: Currency
  to: Currency
  fx: HoldingFx | null
  className?: string
}) {
  if (fx === null) {
    return (
      <span className={cn("text-muted-foreground text-xs", className)}>
        No {from}/{to} rate — value unavailable
      </span>
    )
  }
  if (fx.identity) return null

  return (
    <span className={cn("text-muted-foreground text-xs", className)}>
      at {formatFxRate(from, to, fx.rate)}
      {fx.freshness === "stale" && (
        <span className="text-loss ml-1" title="This rate is over an hour old.">
          · delayed
        </span>
      )}
    </span>
  )
}
