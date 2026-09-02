import type { MetadataRoute } from "next"
import { PUBLIC_PATHS, SITE_URL } from "@/lib/site"

/**
 * Public pages only.
 *
 * A sitemap listing /dashboard would be an invitation to crawl a page that only ever redirects, and
 * a sitemap listing /stocks/NVDA would be a promise of content that does not exist without a
 * session. Stockly is an application, not a content site: six URLs is the honest answer.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date()
  return PUBLIC_PATHS.map((path) => ({
    url: `${SITE_URL}${path === "/" ? "" : path}`,
    lastModified,
    changeFrequency: path === "/" ? ("weekly" as const) : ("yearly" as const),
    priority: path === "/" ? 1 : 0.5,
  }))
}
