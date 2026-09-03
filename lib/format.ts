/**
 * Money formatting, in one place.
 *
 * `currencyDisplay: "narrowSymbol"` is the phase 9 change and it matters: the default renders THB as
 * "THB 1,234.56" and USD as "$1,234.56", so two currencies on the same screen look like different
 * kinds of thing. Narrow symbols give "$1,234.56" and "฿1,234.56" — same shape, unmistakably
 * different unit, which is exactly what a mixed-currency holdings table needs.
 *
 * Where a symbol alone could still be misread — a headline portfolio total, an exported CSV — use
 * `formatCurrencyWithCode`, which appends the ISO code.
 */
import { intlTag, type Locale } from "@/domain/locale"

/**
 * ## Why almost nothing in this file takes a locale
 *
 * Phase 21 measured it rather than assuming it. Across `en-US` and `th-TH-u-ca-gregory`, `Intl`
 * produces **byte-identical output** for every money, quantity, percentage and compact figure
 * Stockly renders:
 *
 * ```
 * en-US               ฿1,234,567.89  $1,234,567.89  1,234,567.12345  4.4T  38M
 * th-TH-u-ca-gregory  ฿1,234,567.89  $1,234,567.89  1,234,567.12345  4.4T  38M
 * ```
 *
 * Thai uses Latin digits, comma grouping and a decimal point, exactly as English does. So a
 * `locale` parameter on `formatCurrency` would be a parameter that changes nothing, threaded
 * through several hundred call sites — and every one of those is a place a future change could
 * make a figure differ between languages. Leaving it out is not an omission; it is the mechanism
 * by which `Thai and English produce exactly the same financial result` is true rather than
 * merely tested. `lib/format.locale.test.ts` pins the equality so a future ICU release cannot
 * quietly break it.
 *
 * **Dates are the exception**, and the only one: month names differ, and so does the era unless it
 * is pinned. Those functions take a `Locale`, and take it as a *required* argument so that the
 * compiler — not a reviewer — finds every place that renders one.
 */
const CURRENCY_CACHE = new Map<string, Intl.NumberFormat>()

function currencyFormatter(currency: string, maximumFractionDigits: number) {
  const key = `${currency}:${maximumFractionDigits}`
  let formatter = CURRENCY_CACHE.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: maximumFractionDigits,
      maximumFractionDigits,
    })
    CURRENCY_CACHE.set(key, formatter)
  }
  return formatter
}

export function formatCurrency(value: number, currency = "USD", fractionDigits = 2): string {
  return currencyFormatter(currency, fractionDigits).format(value)
}

/** "฿825,420.00 THB" — for a headline figure, where the unit must not be inferred from a glyph. */
export function formatCurrencyWithCode(value: number, currency = "USD", fractionDigits = 2): string {
  return `${formatCurrency(value, currency, fractionDigits)} ${currency}`
}

/**
 * A money figure that may not exist — an unconverted holding, a missing rate. Never a fabricated 0:
 * "N/A" is a smaller lie than a zero in a column of real amounts.
 */
export function formatOptionalCurrency(
  value: number | null | undefined,
  currency = "USD",
  fractionDigits = 2,
): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "N/A"
    : formatCurrency(value, currency, fractionDigits)
}

/** Same rule for percentages, which are just as often unknowable. */
export function formatOptionalPercent(
  value: number | null | undefined,
  options?: { signed?: boolean },
): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? "N/A"
    : formatPercent(value, options)
}

/** "USD/THB 32.4500" — how a rate is written everywhere it is shown. */
export function formatFxRate(from: string, to: string, rate: number): string {
  return `${from}/${to} ${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(rate)}`
}

/** Same as formatCurrency but always carries an explicit + or −, for P&L figures. */
export function formatSignedCurrency(value: number, currency = "USD"): string {
  const formatted = formatCurrency(Math.abs(value), currency)
  if (value > 0) return `+${formatted}`
  if (value < 0) return `−${formatted}`
  return formatted
}

export function formatPercent(value: number, { signed = true } = {}): string {
  const formatted = `${Math.abs(value).toFixed(2)}%`
  if (!signed) return formatted
  if (value > 0) return `+${formatted}`
  if (value < 0) return `−${formatted}`
  return formatted
}

export function formatQuantity(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value)
}

const DATE_CACHE = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(locale: Locale, options: Intl.DateTimeFormatOptions, key: string) {
  const tag = intlTag(locale)
  const cacheKey = `${tag}:${key}`
  let formatter = DATE_CACHE.get(cacheKey)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(tag, options)
    DATE_CACHE.set(cacheKey, formatter)
  }
  return formatter
}

/**
 * A calendar date — a trade date, an ex-dividend date, a statement period end.
 *
 * `timeZone: "UTC"` was already here and still matters more than the locale does: these values are
 * `YYYY-MM-DD` with no time, and reading them in the browser's zone would show a trade made on the
 * 3rd as the 2nd to anyone west of Greenwich. The locale changes the month's *name*; it must never
 * change the day.
 *
 * The era comes from `intlTag`, which pins Gregorian for Thai — see `domain/locale.ts`. One
 * transaction, one year, in both languages.
 */
export function formatDate(value: string, locale: Locale): string {
  return dateFormatter(
    locale,
    { year: "numeric", month: "short", day: "2-digit", timeZone: "UTC" },
    "short",
  ).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

/** The long form — "3 กันยายน 2026", "September 3, 2026" — for a headline or a published-on line. */
export function formatLongDate(value: string, locale: Locale): string {
  return dateFormatter(
    locale,
    { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" },
    "long",
  ).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

/** "gain" | "loss" | "flat" — drives colour everywhere, so it is decided in one place. */
export function toneOf(value: number): "gain" | "loss" | "flat" {
  if (value > 0) return "gain"
  if (value < 0) return "loss"
  return "flat"
}

/** Compact money for market cap and volume: $4.4T, 38.0M. Null renders as an em dash. */
export function formatCompact(value: number | null, currency?: string): string {
  /*
   * "N/A", not an em dash.
   *
   * Phase 17.5 found two representations of one meaning in the codebase (UX-001): 82 places said
   * N/A and this said "—". An em dash reads as a separator, a placeholder or a zero depending on
   * the reader, and in a column of numbers that ambiguity is worst. `CLAUDE.md` says a figure that
   * cannot be computed renders as N/A; this now does.
   */
  if (value === null || !Number.isFinite(value)) return "N/A"
  const formatted = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
  return currency ? `${formatted} ${currency}` : formatted
}

/** For provider fields that may legitimately be missing — never show a fabricated 0. */
export function formatOptional(
  value: number | null | undefined,
  format: (value: number) => string,
): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "N/A" : format(value)
}

/**
 * A moment — when a quote was read, when a snapshot was published, when a job ran.
 *
 * Rendered in the viewer's own timezone, which is what `Intl` does when none is named and is the
 * right answer for "how long ago was this". Locale and timezone stay separate concerns: a Thai
 * reader in New York sees Thai month names and New York clock time, which is what they want.
 */
export function formatTime(iso: string, locale: Locale): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "N/A"
  return dateFormatter(
    locale,
    { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" },
    "time",
  ).format(date)
}
