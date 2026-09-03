/**
 * Every translation namespace, in one list.
 *
 * The rule is mechanical, so nobody has to decide: **a namespace is a feature slice**, plus six
 * cross-cutting ones for the things no single feature owns. A string that belongs to
 * `features/transactions` goes in `transactions.json`; a button label used by nine features goes in
 * `common.json`. Adding a feature adds a namespace; there is no third option to weigh.
 *
 * This list is the contract `lib/i18n/completeness.test.ts` checks against the filesystem and
 * against both locale barrels, so a namespace that exists in one language and not the other, or on
 * disk and not in the barrel, is a failing test rather than a missing string in production.
 */
export const NAMESPACES = [
  // Cross-cutting.
  "common",
  "navigation",
  "enums",
  "errors",
  "validation",
  "metadata",

  // One per feature slice in `features/` that has any user-facing text. `features/automation` is
  // the scheduled-refresh layer: it writes counters to `job_executions` and renders nothing, and
  // an empty namespace is a file nobody notices going stale.
  "ai",
  "alerts",
  "analytics",
  "auth",
  "cash",
  "dashboard",
  "dataQuality",
  "dividends",
  "fundamentals",
  "goals",
  "history",
  "imports",
  "intelligence",
  "journal",
  // Not a feature slice: the privacy, terms and disclaimer pages belong to the product, not to
  // any part of it, and their prose is long enough that mixing it into `common` would drown it.
  "legal",
  "news",
  "notifications",
  "operations",
  "personalization",
  "portfolios",
  "pwa",
  "screener",
  // Not a feature slice: the settings *pages* draw from several slices, and the strings that
  // describe the choices themselves belong to none of them.
  "settings",
  "sharing",
  "simulations",
  "stocks",
  "technical",
  "theses",
  "transactions",
  "watchlist",
] as const

export type Namespace = (typeof NAMESPACES)[number]
