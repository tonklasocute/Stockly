import { CheckCircle2, CircleAlert, CircleHelp } from "lucide-react"
import { MARKET_REGISTRY, MARKETS, type Currency, type MarketId } from "@/domain/market"
import { calendarCovers, marketDate, marketSessionStatus } from "@/domain/calendar"
import { fxFreshness, findRate, fxPair, type FxTable } from "@/domain/fx"
import type { MarketStatus } from "@/services/market-data/types"
import { formatFxRate, formatTime } from "@/lib/format"

/**
 * Where every number on the site comes from, and how old it is.
 *
 * Phase 8 gave the app health probes for operators; this is the same idea pointed at the user. A
 * multi-market portfolio has three independent things that can quietly go stale — a market's
 * quotes, an exchange rate, a market's calendar — and a total that silently omits one is worse than
 * a total that says which one it omitted.
 *
 * Nothing here is ever "0" or "OK" by default: a provider that did not answer reads "Unavailable",
 * and a calendar past its verified horizon reads "Unverified".
 */
type Health = { label: string; detail: string; state: "ok" | "warn" | "unknown" }

const ICONS = {
  ok: CheckCircle2,
  warn: CircleAlert,
  unknown: CircleHelp,
} as const

const TONE = {
  ok: "text-gain",
  warn: "text-loss",
  unknown: "text-muted-foreground",
} as const

function marketRow(market: MarketId, status: MarketStatus, now: Date): Health {
  const definition = MARKET_REGISTRY[market]
  const today = marketDate(market, now)
  const covered = calendarCovers(market, today)
  const session = marketSessionStatus(market, now)

  return {
    label: `${definition.label} market`,
    detail:
      status === "unknown"
        ? `Provider status unavailable · calendar says ${session} · ${definition.timeZone}`
        : `${status} · ${definition.timeZone}${covered ? "" : " · calendar unverified beyond " + definition.calendarVerifiedThrough}`,
    // The provider's answer is authoritative; the calendar only fills the gap when there is none.
    state: status === "unknown" ? (covered ? "unknown" : "warn") : "ok",
  }
}

function fxRow(base: Currency, quote: Currency, table: FxTable, now: Date): Health {
  const rate = findRate(table, quote, base)
  if (!rate) {
    return {
      label: fxPair(quote, base),
      detail: "Unavailable — values in this currency show as N/A",
      state: "warn",
    }
  }
  const freshness = fxFreshness(rate, now)
  return {
    label: fxPair(quote, base),
    detail: `${formatFxRate(quote, base, rate.rate)} · ${freshness} · ${formatTime(rate.asOf)}`,
    state: freshness === "fresh" ? "ok" : "warn",
  }
}

export function DataHealth({
  baseCurrency,
  statuses,
  fx,
  now = new Date(),
}: {
  baseCurrency: Currency
  statuses: Record<MarketId, MarketStatus>
  fx: FxTable
  now?: Date
}) {
  const rows: Health[] = [
    ...MARKETS.map((market) => marketRow(market, statuses[market], now)),
    ...MARKETS.map((market) => MARKET_REGISTRY[market].currency)
      .filter((currency, index, all) => all.indexOf(currency) === index && currency !== baseCurrency)
      .map((currency) => fxRow(baseCurrency, currency, fx, now)),
  ]

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">Data health</h2>
        <p className="text-muted-foreground text-xs">
          Prices, exchange rates and trading calendars, as Stockly currently sees them. Anything it
          cannot confirm says so rather than defaulting to a number.
        </p>
      </div>
      <ul className="bg-border grid gap-px overflow-hidden rounded-xl border">
        {rows.map((row) => {
          const Icon = ICONS[row.state]
          return (
            <li key={row.label} className="bg-card flex items-start gap-3 p-3.5">
              <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[row.state]}`} aria-hidden />
              <div className="min-w-0">
                <p className="text-sm font-medium">{row.label}</p>
                <p className="text-muted-foreground text-xs">{row.detail}</p>
              </div>
              {/* Never colour alone: the state is spelled out for anyone who cannot see the icon. */}
              <span className="text-muted-foreground ml-auto text-xs capitalize">{row.state}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
