const CURRENCY_CACHE = new Map<string, Intl.NumberFormat>()

function currencyFormatter(currency: string, maximumFractionDigits: number) {
  const key = `${currency}:${maximumFractionDigits}`
  let formatter = CURRENCY_CACHE.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
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
