import type { Metadata } from "next"
import { PublicPortfolioView } from "@/features/sharing/components/public-portfolio-view"
import { Unavailable } from "@/features/sharing/components/unavailable"
import { readSharedByToken } from "@/features/sharing/public"
import { resolvePublicLocale } from "@/lib/i18n/resolve"

/**
 * A private share link.
 *
 * Three properties, each of which is the reason for a line of code here:
 *
 * - **Never cached.** `force-dynamic` and `revalidate = 0`, so revocation takes effect on the next
 *   request. A revoked link that keeps working until a cache expires has not been revoked.
 * - **Never indexed.** `noindex, nofollow` unconditionally, and `/share/` is disallowed in
 *   robots.txt — a crawler that indexes a capability turns "anyone with the link" into "anyone".
 * - **Never explains itself.** Expired, revoked, mistyped and never-existed all arrive here as
 *   `null`, and all render the same sentence.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Shared portfolio",
  robots: { index: false, follow: false, nocache: true },
}

export default async function SharedLinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const [view, locale] = await Promise.all([
    readSharedByToken(token),
    resolvePublicLocale(await searchParams),
  ])
  if (!view) return <Unavailable reason="LINK" />

  return <PublicPortfolioView portfolio={view.portfolio} asOf={view.publishedAt} locale={locale} />
}
