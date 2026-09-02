/**
 * The canonical origin, in one place.
 *
 * Used by the sitemap, robots.txt and the Open Graph metadata, all of which need absolute URLs.
 * Vercel sets VERCEL_PROJECT_PRODUCTION_URL on every deployment, so a preview build still produces
 * correct absolute links without anyone configuring anything; NEXT_PUBLIC_APP_URL overrides it once
 * a custom domain exists.
 */
function resolveSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/+$/, "")

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel}`

  return "http://localhost:3000"
}

export const SITE_URL = resolveSiteUrl()

export const SITE = {
  name: "Stockly",
  /** Deliberately short: it is the second line of every share card. */
  tagline: "Stock Portfolio & Market Intelligence",
  description:
    "Track your stock portfolio, cost basis and profit and loss. Live prices, technical analysis, " +
    "alerts and a research assistant grounded in your own data.",
} as const

/** The only pages a crawler should ever see. Everything else is behind a session. */
export const PUBLIC_PATHS = ["/", "/login", "/register", "/privacy", "/terms", "/disclaimer"] as const
