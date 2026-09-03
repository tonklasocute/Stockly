import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { PublicPortfolioView } from "@/features/sharing/components/public-portfolio-view"
import { Unavailable } from "@/features/sharing/components/unavailable"
import { readSnapshotByToken } from "@/features/sharing/public"
import { resolvePublicLocale } from "@/lib/i18n/resolve"

/**
 * A snapshot: one projection, frozen.
 *
 * It is reachable by its own token whether or not the portfolio is shared, which is the point — a
 * snapshot is a thing the owner posted, not a window onto a live portfolio. The view is told it is
 * frozen so it labels itself that way; nothing on this page may look like a current figure.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * Localized, and still `noindex` unconditionally.
 *
 * A crawler that indexed a capability link would turn "anyone with the link" into "anyone" — the
 * language of the title has no bearing on that, and the directive stays where it was.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata")
  return {
    title: t("shared.snapshot"),
    robots: { index: false, follow: false, nocache: true },
  }
}

export default async function SnapshotPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { token } = await params
  const [snapshot, locale] = await Promise.all([
    readSnapshotByToken(token),
    resolvePublicLocale(await searchParams),
  ])
  if (!snapshot) return <Unavailable reason="SNAPSHOT" locale={locale} />

  return (
    <PublicPortfolioView
      portfolio={snapshot.portfolio}
      asOf={snapshot.createdAt}
      frozen={{ label: snapshot.label, takenAt: snapshot.calculatedAt }}
      locale={locale}
    />
  )
}
