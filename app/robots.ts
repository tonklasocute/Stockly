import type { MetadataRoute } from "next"
import { SITE_URL } from "@/lib/site"

/**
 * Everything except the marketing and legal pages is disallowed.
 *
 * A crawler could not reach a portfolio anyway — every one of those routes redirects a session-less
 * request to /login — but saying so explicitly means a signed-in page can never be indexed through
 * a leaked link, and it keeps a crawler off endpoints that cost upstream credits.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/login", "/register", "/privacy", "/terms", "/disclaimer"],
        disallow: [
          "/api/",
          "/auth/",
          "/dashboard",
          "/portfolio",
          "/transactions",
          "/analytics",
          "/dividends",
          "/cash",
          "/watchlist",
          "/alerts",
          "/notifications",
          "/screener",
          "/settings",
          "/stocks/",
          "/ai",
          // Phase 10. The journal and theses hold the user's own reasoning, which is the most
          // personal content in the application — it must never be indexable through a leaked link.
          "/review",
          "/goals",
          "/journal",
          "/simulations",
          "/offline",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
