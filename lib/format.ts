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

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
}

/** "gain" | "loss" | "flat" — drives colour everywhere, so it is decided in one place. */
export function toneOf(value: number): "gain" | "loss" | "flat" {
  if (value > 0) return "gain"
  if (value < 0) return "loss"
  return "flat"
}

/** Compact money for market cap and volume: $4.4T, 38.0M. Null renders as an em dash. */
export function formatCompact(value: number | null, currency?: string): string {
  if (value === null || !Number.isFinite(value)) return "—"
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

export function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return "—"
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date)
}
