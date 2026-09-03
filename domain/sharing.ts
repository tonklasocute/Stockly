import type { Currency, MarketId } from "./market"

/**
 * What a visitor is allowed to see, and the one function that decides it.
 *
 * Two rules make this module the privacy boundary rather than one of several places privacy is
 * enforced:
 *
 * 1. **`projectPublicPortfolio` constructs its output field by field.** It never spreads an input
 *    object, never copies an unknown key, and returns a type with no index signature. A field
 *    reaches a visitor because a line here put it there.
 * 2. **A withheld section is absent, not null.** Stockly's `null` means "we could not compute
 *    this honestly" and renders as N/A. "The owner chose not to share this" is a different
 *    statement and gets a different representation — the key simply is not in the document.
 *
 * Pure: no client, no network, no framework import. `sharing-boundary.test.ts` reads this file's
 * source to keep it that way, and walks the projected output looking for anything private.
 */

export const SHARE_VISIBILITIES = ["PRIVATE", "LINK_ONLY", "PUBLIC"] as const
export type ShareVisibility = (typeof SHARE_VISIBILITIES)[number]

/*
 * The words for this enum live in the `enums` namespace, keyed by the same values, in every
 * language Stockly ships. A `Record<Enum, string>` of English here would be the copy the other
 * languages drift away from, and this module is the one that must hold no prose at all.
 */

export const VISIBILITY_HELP: Record<ShareVisibility, string> = {
  PRIVATE: "Only you can see this portfolio. Any share link you have created stops working.",
  LINK_ONLY: "Reachable only by someone holding a link you created. Never indexed by search engines.",
  PUBLIC: "Reachable by anyone at your public address. Indexed only if you also allow that.",
}

/** The document version. Bumped when the shape of a projection changes, so old snapshots stay readable. */
export const SNAPSHOT_VERSION = 1

/**
 * Everything the owner can turn on. All booleans default to false.
 *
 * The three holdings modes in the product — full, allocation only, hidden — are this combination
 * rather than a fourth enum: `showHoldings` off is hidden, on with `showQuantity` and
 * `showAbsoluteValues` off is allocation only, on with both is full. One less thing that can
 * disagree with itself.
 */
export type ShareConfig = {
  visibility: ShareVisibility
  slug: string | null
  displayName: string | null
  description: string | null
  /** What the owner wants to be called on the page. Free text, never derived from the account. */
  ownerDisplayName: string | null

  showOverview: boolean
  showHoldings: boolean
  showAllocation: boolean
  showPerformance: boolean
  showRisk: boolean
  showDividends: boolean
  showBenchmark: boolean
  showInsights: boolean
  showGoals: boolean

  showAbsoluteValues: boolean
  showQuantity: boolean
  showUnrealizedPnl: boolean
  showRealizedPnl: boolean
  showCash: boolean

  allowSearchIndexing: boolean
}

export const DEFAULT_SHARE_CONFIG: ShareConfig = {
  visibility: "PRIVATE",
  slug: null,
  displayName: null,
  description: null,
  ownerDisplayName: null,
  showOverview: false,
  showHoldings: false,
  showAllocation: false,
  showPerformance: false,
  showRisk: false,
  showDividends: false,
  showBenchmark: false,
  showInsights: false,
  showGoals: false,
  showAbsoluteValues: false,
  showQuantity: false,
  showUnrealizedPnl: false,
  showRealizedPnl: false,
  showCash: false,
  allowSearchIndexing: false,
}

export const SHARE_TEMPLATES = ["PRIVATE", "PERFORMANCE", "OVERVIEW", "FULL"] as const
export type ShareTemplate = (typeof SHARE_TEMPLATES)[number]

/*
 * The words for this enum live in the `enums` namespace, keyed by the same values, in every
 * language Stockly ships. A `Record<Enum, string>` of English here would be the copy the other
 * languages drift away from, and this module is the one that must hold no prose at all.
 */

export const TEMPLATE_HELP: Record<ShareTemplate, string> = {
  PRIVATE: "Nothing is shared.",
  PERFORMANCE: "Return, benchmark and allocation percentages. No holdings, no amounts.",
  OVERVIEW: "Holdings and allocation as percentages, plus performance and risk. No amounts.",
  FULL: "Every shareable section, including amounts. Your journal, theses and transactions stay private.",
}

/**
 * A preset is a starting point the owner then edits — never a mode the page runs in.
 *
 * Note what "Everything shareable" does **not** turn on: `showRealizedPnl` and `showCash`. Booked
 * profit and a cash balance are the two figures a reader can least justify needing, and a template
 * called "everything" is exactly where an unnoticed default does its damage. They stay a
 * deliberate, individual choice.
 */
const TEMPLATE_PATCHES: Record<ShareTemplate, Partial<ShareConfig>> = {
  PRIVATE: {},
  PERFORMANCE: {
    showOverview: true,
    showPerformance: true,
    showBenchmark: true,
    showAllocation: true,
  },
  OVERVIEW: {
    showOverview: true,
    showHoldings: true,
    showAllocation: true,
    showPerformance: true,
    showRisk: true,
  },
  FULL: {
    showOverview: true,
    showHoldings: true,
    showAllocation: true,
    showPerformance: true,
    showRisk: true,
    showDividends: true,
    showBenchmark: true,
    showInsights: true,
    showAbsoluteValues: true,
    showQuantity: true,
    showUnrealizedPnl: true,
  },
}

/** Applies a preset over the all-off default, keeping identity and visibility as they were. */
export function applyTemplate(config: ShareConfig, template: ShareTemplate): ShareConfig {
  return {
    ...DEFAULT_SHARE_CONFIG,
    ...TEMPLATE_PATCHES[template],
    visibility: config.visibility,
    slug: config.slug,
    displayName: config.displayName,
    description: config.description,
    ownerDisplayName: config.ownerDisplayName,
    // Never re-enabled by a preset. Turning a portfolio public is one decision; inviting Google is
    // another, and a template must not make it on the owner's behalf.
    allowSearchIndexing: false,
  }
}

/**
 * Segments the router owns, or that would read as something they are not.
 *
 * A slug is matched at `/p/<slug>`, so a collision is a routing bug rather than a security one —
 * but "admin" and "login" in a shareable URL invite a different mistake, and refusing them costs a
 * list.
 */
export const RESERVED_SLUGS: readonly string[] = [
  "api", "app", "auth", "admin", "login", "logout", "register", "signin", "signup",
  "settings", "dashboard", "portfolio", "portfolios", "share", "shares", "snapshot",
  "snapshots", "new", "edit", "delete", "privacy", "terms", "disclaimer", "offline",
  "stockly", "support", "help", "about", "p", "s",
]

/**
 * Turns whatever the owner typed into a URL segment, or null if nothing usable survives.
 *
 * Deliberately lossy and deliberately not clever: lowercase, ASCII alphanumerics and hyphens, no
 * runs, no ends. A transliteration table for every script would be a dependency and a source of
 * surprises; a Thai portfolio name that reduces to nothing returns null and the owner types
 * something else, which is a better outcome than a slug they cannot read.
 */
export function normalizeSlug(raw: string): string | null {
  const slug = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "")

  if (slug.length < 3) return null
  if (RESERVED_SLUGS.includes(slug)) return null
  return slug
}

export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= 3 &&
    slug.length <= 48 &&
    /^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) &&
    !RESERVED_SLUGS.includes(slug)
  )
}

// ---------------------------------------------------------------- share links

export const LINK_STATES = ["VALID", "EXPIRED", "REVOKED"] as const
export type LinkState = (typeof LINK_STATES)[number]

export type ShareLinkFacts = {
  expiresAt: string | null
  revokedAt: string | null
}

/**
 * Revocation wins over expiry: a link the owner deliberately turned off should say so, even if it
 * would also have lapsed on its own.
 */
export function linkState(link: ShareLinkFacts, now: Date): LinkState {
  if (link.revokedAt !== null) return "REVOKED"
  if (link.expiresAt !== null && Date.parse(link.expiresAt) <= now.getTime()) return "EXPIRED"
  return "VALID"
}

export const LINK_DURATIONS = [
  { key: "1D", label: "1 day", days: 1 },
  { key: "7D", label: "7 days", days: 7 },
  { key: "30D", label: "30 days", days: 30 },
  { key: "NEVER", label: "No expiry", days: null },
] as const
export type LinkDuration = (typeof LINK_DURATIONS)[number]["key"]

export function expiryFor(duration: LinkDuration, now: Date): string | null {
  const entry = LINK_DURATIONS.find((d) => d.key === duration)
  if (!entry || entry.days === null) return null
  return new Date(now.getTime() + entry.days * 86_400_000).toISOString()
}

// ---------------------------------------------------------------- the projection

/**
 * Everything the projector is given.
 *
 * Assembled by `features/sharing` from the analytics and intelligence bundles. It is narrow on
 * purpose: the projector cannot withhold a journal entry it was never handed, and the type is the
 * list of what sharing is even capable of exposing. Adding a field here is the moment to ask
 * whether it should be shareable at all.
 */
export type ShareSource = {
  portfolioName: string
  baseCurrency: Currency
  /** When the figures were computed. Not when the row was written. */
  calculatedAt: string

  freshness: {
    marketDataStale: boolean
    staleMarkets: readonly MarketId[]
    missingFxPairs: readonly string[]
    untranslatedCount: number
  }

  overview: {
    totalValue: number
    investedValue: number
    cashValue: number
    unrealizedPnl: number
    realizedPnl: number
    returnPct: number
    todayReturnPct: number | null
    holdingsCount: number
  }

  holdings: readonly {
    symbol: string
    market: MarketId
    currency: Currency
    quantity: number
    /** In the portfolio's base currency. Null when no rate reached it — never 0. */
    baseMarketValue: number | null
    weightPct: number | null
    unrealizedPnl: number
    returnPct: number
    stale: boolean
  }[]

  allocation: readonly AllocationEntry[]
  markets: readonly AllocationEntry[]
  currencies: readonly AllocationEntry[]

  performance: {
    timeWeightedReturnPct: number | null
    moneyWeightedReturnPct: number | null
    range: string
    /** Indexed to 100 at the start, so it carries no portfolio size. */
    series: readonly { date: string; index: number }[]
  }

  benchmark: {
    name: string
    portfolioReturnPct: number | null
    benchmarkReturnPct: number | null
    differencePct: number | null
    unavailableReason: string | null
  } | null

  risk: {
    volatilityPct: number | null
    maxDrawdownPct: number | null
    sharpe: number | null
    beta: number | null
    topWeightPct: number | null
    observations: number
    limitations: readonly string[]
  }

  income: {
    trailingTwelveMonths: number | null
    yieldOnValuePct: number | null
    yieldOnCostPct: number | null
  }

  goals: readonly { label: string; progressPct: number | null; targetLabel: string }[]

  insights: readonly { code: string; title: string; detail: string }[]
}

export type AllocationEntry = { key: string; label: string; weightPct: number }

// ---------------------------------------------------------------- the public document

export type PublicOverview = {
  returnPct: number
  todayReturnPct: number | null
  holdingsCount: number
  totalValue?: number
  investedValue?: number
  cashValue?: number
  unrealizedPnl?: number
  realizedPnl?: number
}

export type PublicHolding = {
  symbol: string
  market: MarketId
  currency: Currency
  weightPct: number | null
  stale: boolean
  quantity?: number
  marketValue?: number | null
  unrealizedPnl?: number
  returnPct?: number
}

export type PublicSections = {
  overview?: PublicOverview
  holdings?: { positions: PublicHolding[]; hiddenCount: number }
  allocation?: { positions: AllocationEntry[]; markets: AllocationEntry[]; currencies: AllocationEntry[] }
  performance?: ShareSource["performance"]
  benchmark?: NonNullable<ShareSource["benchmark"]>
  risk?: ShareSource["risk"]
  income?: { yieldOnValuePct: number | null; yieldOnCostPct: number | null; trailingTwelveMonths?: number | null }
  goals?: { label: string; progressPct: number | null; targetLabel?: string }[]
  insights?: { code: string; title: string; detail: string }[]
}

/**
 * What a visitor receives. No id of any kind, no user, no transaction, no journal, no thesis.
 *
 * `ownerDisplayName` is whatever the owner typed into a free-text box. It is never derived from the
 * account — an email address must not become a byline because somebody left a field blank.
 */
export type PublicPortfolio = {
  version: number
  displayName: string
  description: string | null
  baseCurrency: Currency
  ownerDisplayName: string | null
  calculatedAt: string
  freshness: ShareSource["freshness"]
  sections: PublicSections
}

/** The most positions a public page lists. Beyond this the tail is summarised as a count. */
export const MAX_PUBLIC_HOLDINGS = 50

/** The most points a published performance series carries, so the payload stays a page. */
export const MAX_PUBLIC_SERIES_POINTS = 400

/** Keeps the first and last point and thins evenly between them. */
export function thinSeries<T>(points: readonly T[], max = MAX_PUBLIC_SERIES_POINTS): T[] {
  if (points.length <= max) return [...points]
  const step = (points.length - 1) / (max - 1)
  const out: T[] = []
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)])
  return out
}

/**
 * The projection. Everything a visitor can see passes through here and nothing else does.
 *
 * Read it as a list of decisions rather than a transformation: each `if` is one thing the owner
 * turned on, and each assignment is one field that is therefore allowed out.
 */
export function projectPublicPortfolio(source: ShareSource, config: ShareConfig): PublicPortfolio {
  const sections: PublicSections = {}
  const money = config.showAbsoluteValues

  if (config.showOverview) {
    const overview: PublicOverview = {
      returnPct: source.overview.returnPct,
      todayReturnPct: source.overview.todayReturnPct,
      holdingsCount: source.overview.holdingsCount,
    }
    // A percentage return says how the portfolio did; an amount says how much money the reader is
    // looking at. Sharing the first is not consent to the second.
    if (money) {
      overview.totalValue = source.overview.totalValue
      overview.investedValue = source.overview.investedValue
    }
    if (money && config.showCash) overview.cashValue = source.overview.cashValue
    if (config.showUnrealizedPnl && money) overview.unrealizedPnl = source.overview.unrealizedPnl
    if (config.showRealizedPnl && money) overview.realizedPnl = source.overview.realizedPnl
    sections.overview = overview
  }

  if (config.showHoldings) {
    const listed = source.holdings.slice(0, MAX_PUBLIC_HOLDINGS)
    sections.holdings = {
      positions: listed.map((holding) => {
        const position: PublicHolding = {
          symbol: holding.symbol,
          market: holding.market,
          currency: holding.currency,
          weightPct: holding.weightPct,
          stale: holding.stale,
        }
        // Quantity plus a public price is the position's value however it is presented, so it is
        // gated on its own and not merely on the amounts flag.
        if (config.showQuantity) position.quantity = holding.quantity
        if (money) position.marketValue = holding.baseMarketValue
        if (config.showUnrealizedPnl) {
          position.returnPct = holding.returnPct
          if (money) position.unrealizedPnl = holding.unrealizedPnl
        }
        return position
      }),
      hiddenCount: Math.max(0, source.holdings.length - listed.length),
    }
  }

  if (config.showAllocation) {
    sections.allocation = {
      positions: source.allocation.map(entry),
      markets: source.markets.map(entry),
      currencies: source.currencies.map(entry),
    }
  }

  if (config.showPerformance) {
    sections.performance = {
      timeWeightedReturnPct: source.performance.timeWeightedReturnPct,
      moneyWeightedReturnPct: source.performance.moneyWeightedReturnPct,
      range: source.performance.range,
      series: thinSeries(source.performance.series),
    }
  }

  if (config.showBenchmark && source.benchmark !== null) {
    sections.benchmark = {
      name: source.benchmark.name,
      portfolioReturnPct: source.benchmark.portfolioReturnPct,
      benchmarkReturnPct: source.benchmark.benchmarkReturnPct,
      differencePct: source.benchmark.differencePct,
      unavailableReason: source.benchmark.unavailableReason,
    }
  }

  if (config.showRisk) {
    sections.risk = {
      volatilityPct: source.risk.volatilityPct,
      maxDrawdownPct: source.risk.maxDrawdownPct,
      sharpe: source.risk.sharpe,
      beta: source.risk.beta,
      topWeightPct: source.risk.topWeightPct,
      observations: source.risk.observations,
      limitations: [...source.risk.limitations],
    }
  }

  if (config.showDividends) {
    // A yield is a ratio and carries no portfolio size; the amount it was computed from does.
    sections.income = {
      yieldOnValuePct: source.income.yieldOnValuePct,
      yieldOnCostPct: source.income.yieldOnCostPct,
      ...(money ? { trailingTwelveMonths: source.income.trailingTwelveMonths } : {}),
    }
  }

  if (config.showGoals) {
    // Progress, never the plan. A target of "฿4,000,000 by 2035" is a statement about someone's
    // life, not about their portfolio, so it travels only with the amounts flag.
    sections.goals = source.goals.map((goal) => ({
      label: goal.label,
      progressPct: goal.progressPct,
      ...(money ? { targetLabel: goal.targetLabel } : {}),
    }))
  }

  if (config.showInsights) {
    sections.insights = source.insights.map((insight) => ({
      code: insight.code,
      title: insight.title,
      detail: insight.detail,
    }))
  }

  return {
    version: SNAPSHOT_VERSION,
    // Falls back to the portfolio's own name only because the owner has to have picked sharing
    // deliberately to get here at all. It is never an account identifier.
    displayName: config.displayName?.trim() || source.portfolioName,
    description: config.description?.trim() || null,
    baseCurrency: source.baseCurrency,
    ownerDisplayName: config.ownerDisplayName?.trim() || null,
    calculatedAt: source.calculatedAt,
    freshness: {
      marketDataStale: source.freshness.marketDataStale,
      staleMarkets: [...source.freshness.staleMarkets],
      missingFxPairs: [...source.freshness.missingFxPairs],
      untranslatedCount: source.freshness.untranslatedCount,
    },
    sections,
  }
}

function entry(slice: AllocationEntry): AllocationEntry {
  return { key: slice.key, label: slice.label, weightPct: slice.weightPct }
}

/** True when a visibility should tell crawlers to stay away. */
export function shouldNoIndex(visibility: ShareVisibility, allowSearchIndexing: boolean): boolean {
  return visibility !== "PUBLIC" || !allowSearchIndexing
}

/**
 * Shown on every shared page. Short, and it does not claim more than it can.
 */
export const SHARE_DISCLAIMER =
  "Shared for information only. This is not investment advice, not a recommendation, and not a " +
  "guarantee of future performance. Figures are calculated by Stockly from the owner's own records " +
  "and may be delayed."
