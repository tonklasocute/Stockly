/**
 * Foreign exchange, as a domain concept.
 *
 * Three rules, and everything else follows from them:
 *
 * 1. **A missing rate is `null`, never 1 and never 0.** A conversion that cannot be done honestly
 *    is not a conversion of zero — it is an unknown, and the UI renders it "N/A". Defaulting to 1
 *    would silently value a ฿32 stock at $32.
 * 2. **A rate carries the moment it was taken.** Prices already do; a rate that does not is a
 *    number with no way to tell whether it is minutes or days old, and the difference between
 *    those two shows up in the portfolio total.
 * 3. **Today's rate translates today's value, and nothing else.** Cost basis, realized P&L and
 *    every past transaction happened at a rate this system does not have. Translating them at the
 *    current rate would blend currency movement into stock performance and call the result "your
 *    return". `fxEffect` therefore reports `null` — see `docs/MULTI-MARKET.md`.
 *
 * Pure: no clock of its own, no network, no framework. `now` is always passed in.
 */
import { multiply, quantize } from "./money"
import type { Currency } from "./market"

/** One hour. A rate older than this is still used, but every figure derived from it says "stale". */
export const FX_STALE_AFTER_MS = 60 * 60 * 1000

/** Beyond a day a rate is not stale, it is wrong: a weekend of news can move a pair by percent. */
export const FX_UNUSABLE_AFTER_MS = 24 * 60 * 60 * 1000

export type FxRate = {
  base: Currency
  quote: Currency
  /** One unit of `base` costs this many units of `quote`. USD/THB 32.45 → $1 = ฿32.45. */
  rate: number
  /** When the provider says this rate was taken, ISO 8601. */
  asOf: string
  provider: string
}

export type FxFreshness = "fresh" | "stale" | "unavailable"

/** The result of translating an amount, carrying enough to show the user the working. */
export type FxConversion = {
  /** The amount in the target currency. */
  value: number
  /** The rate applied — 1 when both currencies are the same. */
  rate: number
  /** Null only for the identity conversion, which no provider was asked about. */
  asOf: string | null
  freshness: FxFreshness
  /** True when no rate was needed because the currencies match. */
  identity: boolean
}

export function fxPair(base: Currency, quote: Currency): string {
  return `${base}/${quote}`
}

export function fxAgeMs(rate: Pick<FxRate, "asOf">, now: Date): number | null {
  const at = Date.parse(rate.asOf)
  if (Number.isNaN(at)) return null
  return Math.max(0, now.getTime() - at)
}

/**
 * "fresh" under the threshold, "stale" over it, "unavailable" past a day or with an unparseable
 * timestamp — a rate we cannot date is a rate we cannot vouch for.
 */
export function fxFreshness(
  rate: Pick<FxRate, "asOf">,
  now: Date,
  staleAfterMs: number = FX_STALE_AFTER_MS,
): FxFreshness {
  const age = fxAgeMs(rate, now)
  if (age === null || age > FX_UNUSABLE_AFTER_MS) return "unavailable"
  return age > staleAfterMs ? "stale" : "fresh"
}

// ---------------------------------------------------------------- rate table

/**
 * The rates one request has to work with. Built once per request from one provider call per pair,
 * so ten holdings in two currencies cost one lookup each and at most two upstream calls.
 */
export type FxTable = {
  rates: ReadonlyMap<string, FxRate>
  /** Pairs that were asked for and could not be answered. The UI names them rather than hiding them. */
  missing: readonly string[]
}

export const EMPTY_FX_TABLE: FxTable = { rates: new Map(), missing: [] }

export function buildFxTable(rates: readonly FxRate[], missing: readonly string[] = []): FxTable {
  const map = new Map<string, FxRate>()
  for (const rate of rates) {
    if (!Number.isFinite(rate.rate) || rate.rate <= 0) continue
    map.set(fxPair(rate.base, rate.quote), rate)
  }
  return { rates: map, missing }
}

/**
 * The rate to get from `from` to `to`, direct or inverted.
 *
 * Inversion is exact enough here — a mid-market rate has no bid/ask spread to get backwards — and
 * halves the number of upstream calls. Triangulation through USD is deliberately *not* done: a
 * EUR→THB rate synthesised from two other rates is a number no provider would stand behind, and
 * `null` is the honest answer until a provider is asked for that pair directly.
 */
export function findRate(table: FxTable, from: Currency, to: Currency): FxRate | null {
  const direct = table.rates.get(fxPair(from, to))
  if (direct) return direct

  const inverse = table.rates.get(fxPair(to, from))
  if (inverse && inverse.rate > 0) {
    return {
      base: from,
      quote: to,
      rate: quantize(1 / inverse.rate, 1_000_000_000),
      asOf: inverse.asOf,
      provider: inverse.provider,
    }
  }
  return null
}

/**
 * Translates an amount. Null — not zero — when there is no rate, which is what makes every
 * downstream `baseMarketValue` honestly nullable.
 */
export function convert(
  amount: number,
  from: Currency,
  to: Currency,
  table: FxTable,
  now: Date,
  staleAfterMs: number = FX_STALE_AFTER_MS,
): FxConversion | null {
  if (!Number.isFinite(amount)) return null
  if (from === to) {
    return { value: quantize(amount), rate: 1, asOf: null, freshness: "fresh", identity: true }
  }

  const rate = findRate(table, from, to)
  if (!rate) return null

  const freshness = fxFreshness(rate, now, staleAfterMs)
  // A rate too old to vouch for produces no number at all, exactly like a missing one.
  if (freshness === "unavailable") return null

  return {
    value: multiply(amount, rate.rate),
    rate: rate.rate,
    asOf: rate.asOf,
    freshness,
    identity: false,
  }
}

/**
 * A converter bound to one target currency and one instant — the shape the holdings engine takes,
 * so the engine itself never learns what an FX provider is.
 */
export type Converter = (amount: number, from: Currency) => FxConversion | null

export function converterTo(
  target: Currency,
  table: FxTable,
  now: Date,
  staleAfterMs: number = FX_STALE_AFTER_MS,
): Converter {
  return (amount, from) => convert(amount, from, target, table, now, staleAfterMs)
}

/** The converter used when no FX layer is wired in: same currency passes through, nothing else does. */
export function identityConverter(target: Currency): Converter {
  return (amount, from) =>
    from === target
      ? { value: quantize(amount), rate: 1, asOf: null, freshness: "fresh", identity: true }
      : null
}
