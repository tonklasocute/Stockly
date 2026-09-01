/**
 * One spelling of a symbol, everywhere. Users type "nvda", providers return "NVDA", and a URL may
 * carry either; without a single normaliser they become different keys in the same Map.
 */
export type Market = "US" | "SET"

export const MARKETS: readonly Market[] = ["US", "SET"]

/** Uppercases, trims, and strips characters no ticker uses. Returns "" for unusable input. */
export function normalizeSymbol(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-&]/g, "")
    .slice(0, 20)
}

export function isValidSymbol(input: string): boolean {
  const symbol = normalizeSymbol(input)
  return symbol.length > 0 && /^[A-Z0-9][A-Z0-9.\-&]*$/.test(symbol)
}

/**
 * Symbols are only unique within a market — "CPALL" on SET and a US ticker could collide — so
 * anything keyed by symbol (quote caches, holdings maps) is keyed by this instead.
 */
export function symbolKey(symbol: string, market: Market = "US"): string {
  return `${market}:${normalizeSymbol(symbol)}`
}

export function isMarket(value: string): value is Market {
  return (MARKETS as readonly string[]).includes(value)
}

/** Parses a market from a query param, falling back to US rather than throwing. */
export function toMarket(value: string | null | undefined): Market {
  return value && isMarket(value.toUpperCase()) ? (value.toUpperCase() as Market) : "US"
}
