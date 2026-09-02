/**
 * Markets, currencies and instruments.
 *
 * Phase 9 turns Stockly from "US stocks priced in dollars" into a system where every price carries
 * the market it was quoted on and the currency it was quoted in. The rule that makes that possible
 * is here: **a market is a row in a registry, never an `if` in a call site.** Adding Japan means
 * adding an entry below and an adapter behind `MarketDataProvider`; no domain function changes.
 *
 * Everything in this file is pure — no framework, no network, no clock beyond what is passed in —
 * so a market's behaviour is unit-testable without a database or a provider account.
 *
 * Currency is derived from the market rather than stored per row. A stock listed on SET trades in
 * baht; storing the currency separately would let `market = 'US', currency = 'THB'` exist, and the
 * first time those two disagreed every number computed from them would be wrong in a way nothing
 * could detect. Cash and dividends *do* carry their own currency, because a baht dividend on a US
 * ADR is a real thing and is not derivable.
 *
 * `ponytail:` ceiling — one currency per market. A venue that quotes the same instrument in two
 * currencies (HKEX's dual-counter model) needs `currency` on the instrument instead of on the
 * market; every caller already reads it through `currencyOf`/`instrument.currency`, so that change
 * is this file plus a migration, not a rewrite.
 */

// ---------------------------------------------------------------- currency

/**
 * Currencies Stockly can denominate a portfolio in. USD and THB are the two it can price and
 * convert today; the rest are accepted as a base currency and render as "N/A" until an FX rate for
 * them exists, which is the honest answer rather than a fabricated conversion.
 */
export const CURRENCIES = ["USD", "THB", "EUR", "GBP", "JPY", "SGD", "HKD"] as const

export type Currency = (typeof CURRENCIES)[number]

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value)
}

/** Parses a currency from untrusted input. Null — never a fallback — when it is not one we know. */
export function toCurrency(value: string | null | undefined): Currency | null {
  if (!value) return null
  const upper = value.trim().toUpperCase()
  return isCurrency(upper) ? upper : null
}

/**
 * A portfolio's base currency, read from a `text` database column.
 *
 * Falls back to USD rather than throwing: the column predates the enum, so a row could hold
 * anything, and a portfolio that will not render is worse than one rendered in the currency every
 * pre-phase-9 row was implicitly in. A value outside the set is a data-quality problem, not a
 * reason to lose the page.
 */
export function baseCurrencyOf(value: string | null | undefined): Currency {
  return toCurrency(value) ?? "USD"
}

/** How many minor units a currency has, for display. Both supported currencies use two. */
const CURRENCY_DECIMALS: Partial<Record<Currency, number>> = { JPY: 0 }

export function currencyDecimals(currency: Currency): number {
  return CURRENCY_DECIMALS[currency] ?? 2
}

// ---------------------------------------------------------------- market registry

export const MARKETS = ["US", "SET"] as const

export type MarketId = (typeof MARKETS)[number]

/** Kept as an alias: `Market` is the name every existing import uses. */
export type Market = MarketId

export type AssetType = "STOCK" | "ETF" | "FUND" | "INDEX" | "WARRANT" | "DR"

/** A local wall-clock window on a trading day, in the market's own timezone. */
export type TradingSession = { open: string; close: string }

export type MarketDefinition = {
  id: MarketId
  /** Shown to users. Short enough for a badge. */
  label: string
  /** ISO 3166-1 alpha-2. Providers key country filters off this. */
  country: string
  /** The currency every instrument on this market is quoted in. */
  currency: Currency
  /** IANA zone. The browser's clock is never used to decide whether a market is open. */
  timeZone: string
  /** Exchange codes that belong to this market; the first is the default for a bare symbol. */
  exchanges: readonly string[]
  /** Continuous trading windows, local time. SET has two — a lunch break is not a half day. */
  sessions: readonly TradingSession[]
  /** Auction/pre-open window before the first session, local time. Null when there is none. */
  preSession: TradingSession | null
  postSession: TradingSession | null
  /** ISO weekday numbers (0 = Sunday) on which the market never trades. */
  weekend: readonly number[]
  /**
   * Full-day closures, ISO dates in the market's own timezone. Empty for years past
   * `calendarVerifiedThrough` — see `domain/calendar.ts` for why that returns "unknown" rather
   * than guessing the market is open.
   */
  holidays: readonly string[]
  /**
   * The last date the holiday table above was checked against the exchange's published calendar.
   * Beyond it the calendar answers "unknown", never "open".
   */
  calendarVerifiedThrough: string
  /** Symbols legal on this venue. SET allows the `-R`/`-F` share-class suffixes US tickers do not. */
  symbolPattern: RegExp
}

/**
 * US holidays are the NYSE/NASDAQ full-day closures. Half days (the 1pm closes around Thanksgiving
 * and Christmas) are deliberately not modelled: the market *is* open on those days, and a wrong
 * closing time costs a label while a wrong open/closed costs an alert.
 */
const US_HOLIDAYS = [
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
  "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31",
  "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
] as const

/**
 * SET closures. The fixed-date national holidays are listed; the Buddhist holidays that move with
 * the lunar calendar (Makha Bucha, Visakha Bucha, Asarnha Bucha, Khao Phansa) are **not**, because
 * their dates come from a calendar this file cannot compute.
 *
 * That is why `calendarVerifiedThrough` exists and why the provider's reported status always wins
 * over this table: a missing holiday would otherwise make Stockly say "open" on a day the exchange
 * was shut. Refresh both the list and the date from SET's published calendar each December.
 */
const SET_HOLIDAYS = [
  // 2026 — fixed-date national holidays only.
  "2026-01-01", "2026-01-02", "2026-04-06", "2026-04-13", "2026-04-14", "2026-04-15",
  "2026-05-01", "2026-06-03", "2026-07-28", "2026-08-12", "2026-10-13", "2026-10-23",
  "2026-12-07", "2026-12-10", "2026-12-31",
] as const

export const MARKET_REGISTRY: Record<MarketId, MarketDefinition> = {
  US: {
    id: "US",
    label: "US",
    country: "US",
    currency: "USD",
    timeZone: "America/New_York",
    exchanges: ["NASDAQ", "NYSE", "NYSE ARCA", "AMEX", "BATS", "OTC"],
    sessions: [{ open: "09:30", close: "16:00" }],
    preSession: { open: "04:00", close: "09:30" },
    postSession: { open: "16:00", close: "20:00" },
    weekend: [0, 6],
    holidays: US_HOLIDAYS,
    calendarVerifiedThrough: "2027-12-31",
    symbolPattern: /^[A-Z][A-Z0-9.\-]{0,11}$/,
  },
  SET: {
    id: "SET",
    label: "SET",
    country: "TH",
    currency: "THB",
    timeZone: "Asia/Bangkok",
    exchanges: ["SET", "mai"],
    // Morning and afternoon sessions. The midday break is not a trading window.
    sessions: [
      { open: "10:00", close: "12:30" },
      { open: "14:30", close: "16:30" },
    ],
    preSession: { open: "09:30", close: "10:00" },
    postSession: null,
    weekend: [0, 6],
    holidays: SET_HOLIDAYS,
    // Deliberately short: the lunar holidays for 2027 are not in the table above.
    calendarVerifiedThrough: "2026-12-31",
    // PTT, CPALL, ADVANC, and the suffixed classes: PTT-R (registered), SCB-F (foreign), DELTA13.
    symbolPattern: /^[A-Z][A-Z0-9&]{0,9}(-[A-Z]{1,2})?$/,
  },
}

export function isMarket(value: unknown): value is MarketId {
  return typeof value === "string" && (MARKETS as readonly string[]).includes(value)
}

/**
 * Parses a market from a query param or a database column, falling back to US rather than throwing.
 * US is the right fallback and not a fabrication: every row written before phase 9 is a US row, and
 * the column defaults to 'US' in the schema.
 */
export function toMarket(value: string | null | undefined): MarketId {
  const upper = value?.trim().toUpperCase()
  return isMarket(upper) ? upper : "US"
}

/** Strict parse for request bodies, where a wrong market must be a 400 rather than a silent US. */
export function parseMarket(value: string | null | undefined): MarketId | null {
  const upper = value?.trim().toUpperCase()
  return isMarket(upper) ? upper : null
}

export function marketOf(market: MarketId): MarketDefinition {
  return MARKET_REGISTRY[market]
}

/** The currency instruments on this market are quoted in. The single source of that mapping. */
export function currencyOf(market: MarketId): Currency {
  return MARKET_REGISTRY[market].currency
}

export function defaultExchangeOf(market: MarketId): string {
  return MARKET_REGISTRY[market].exchanges[0]
}

/** Which market an exchange code belongs to, for normalising whatever a provider returns. */
export function marketOfExchange(exchange: string | null | undefined): MarketId | null {
  if (!exchange) return null
  const code = exchange.trim().toUpperCase()
  for (const market of MARKETS) {
    if (MARKET_REGISTRY[market].exchanges.some((e) => e.toUpperCase() === code)) return market
  }
  return null
}

/** Every market that quotes in this currency. Used to decide which FX pairs a request needs. */
export function marketsUsing(currency: Currency): MarketId[] {
  return MARKETS.filter((m) => MARKET_REGISTRY[m].currency === currency)
}

// ---------------------------------------------------------------- symbols

/**
 * One spelling of a symbol, everywhere. Users type "nvda", providers return "NVDA", and a URL may
 * carry either; without a single normaliser they become different keys in the same Map.
 *
 * The character class is the union across markets — SET's `-R`/`-F` suffixes and `&` in names like
 * `M&S` are legal here — and `isValidSymbol` narrows it per market.
 */
export function normalizeSymbol(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.\-&]/g, "")
    .slice(0, 20)
}

/**
 * Valid for the given market. Without a market this is the loose, market-agnostic check the app
 * used before phase 9 — a URL segment has to be accepted before the market is known.
 */
export function isValidSymbol(input: string, market?: MarketId): boolean {
  const symbol = normalizeSymbol(input)
  if (!symbol) return false
  if (!market) return /^[A-Z0-9][A-Z0-9.\-&]*$/.test(symbol)
  return MARKET_REGISTRY[market].symbolPattern.test(symbol)
}

/**
 * Symbols are only unique within a market — a SET ticker and a US ticker can spell the same three
 * letters — so anything keyed by symbol (quote caches, holdings maps, snapshot rows) is keyed by
 * this instead.
 */
export function symbolKey(symbol: string, market: MarketId = "US"): string {
  return `${market}:${normalizeSymbol(symbol)}`
}

export function parseSymbolKey(key: string): { market: MarketId; symbol: string } {
  const [market, ...rest] = key.split(":")
  return { market: toMarket(market), symbol: normalizeSymbol(rest.join(":")) }
}

// ---------------------------------------------------------------- instrument

/**
 * What is being traded, independent of who owns it or what it costs.
 *
 * Everything downstream reads `instrument.market` and `instrument.currency` rather than inspecting
 * the symbol: `if (symbol === "PTT")` is the shape this type exists to prevent.
 */
export type Instrument = {
  symbol: string
  market: MarketId
  currency: Currency
  name: string | null
  exchange: string | null
  assetType: AssetType
}

/** Builds an instrument from a symbol and its market, filling the market-derived fields. */
export function instrumentOf(
  symbol: string,
  market: MarketId = "US",
  extra: Partial<Pick<Instrument, "name" | "exchange" | "assetType">> = {},
): Instrument {
  return {
    symbol: normalizeSymbol(symbol),
    market,
    currency: currencyOf(market),
    name: extra.name ?? null,
    exchange: extra.exchange ?? defaultExchangeOf(market),
    assetType: extra.assetType ?? "STOCK",
  }
}

export function instrumentKey(instrument: Pick<Instrument, "symbol" | "market">): string {
  return symbolKey(instrument.symbol, instrument.market)
}

/** Groups anything carrying a market, so a provider is called once per market and not once per row. */
export function groupByMarket<T extends { market: MarketId }>(items: readonly T[]): Map<MarketId, T[]> {
  const out = new Map<MarketId, T[]>()
  for (const item of items) {
    const bucket = out.get(item.market)
    if (bucket) bucket.push(item)
    else out.set(item.market, [item])
  }
  return out
}
