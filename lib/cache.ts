import "server-only"

import { revalidatePath } from "next/cache"

/**
 * One place that knows what a write invalidates.
 *
 * Every page that shows a number derives it on the server from Supabase, so there is no stored
 * aggregate to update — invalidation means telling Next to re-render the routes that read it. The
 * alternative, sprinkling `revalidatePath` calls through route handlers, is how the dashboard and
 * the analytics page end up disagreeing after a delete.
 *
 * Market-data responses are cached separately, by tag, in services/market-data — a new transaction
 * must not discard a quote that is still fresh.
 */
const PORTFOLIO_ROUTES = [
  "/dashboard",
  "/portfolio",
  "/transactions",
  "/analytics",
  "/dividends",
  "/cash",
] as const

/**
 * Anything that changes a portfolio's numbers: a transaction, a dividend, a cash movement, or the
 * portfolio itself. Holdings, P&L, allocation, cash balance and every analytic derive from the same
 * rows, so they are invalidated together rather than guessed at individually.
 */
export function invalidatePortfolio(): void {
  for (const route of PORTFOLIO_ROUTES) revalidatePath(route)
}

/** The watchlist is independent of portfolio maths, so it invalidates on its own. */
export function invalidateWatchlist(): void {
  revalidatePath("/watchlist")
  // A stock page shows whether the symbol is watched.
  revalidatePath("/stocks/[symbol]", "page")
}

/** Alerts, notifications and the unread badge, which the app shell renders on every page. */
export function invalidateAlerts(): void {
  revalidatePath("/alerts")
  revalidatePath("/notifications")
  revalidatePath("/settings/notifications")
  // The badge lives in the shell, so every route that renders it has to re-render.
  revalidatePath("/", "layout")
}
