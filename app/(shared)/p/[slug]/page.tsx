import type { Metadata } from "next"
import { PublicPortfolioView } from "@/features/sharing/components/public-portfolio-view"
import { Unavailable } from "@/features/sharing/components/unavailable"
import { readPublicShare } from "@/features/sharing/public"
import { getTranslations } from "next-intl/server"
import { SUPPORTED_LOCALES } from "@/domain/locale"
import { resolvePublicLocale } from "@/lib/i18n/resolve"
import { SITE_URL } from "@/lib/site"

/**
 * A public portfolio, at the address its owner chose.
 *
 * The anonymous Supabase role can select from `published_shares` only where visibility is PUBLIC,
 * so a LINK_ONLY or PRIVATE portfolio at a guessed slug returns nothing here — the restriction is
 * the database's, not this file's.
 */
type Params = {
  params: Promise<{ slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

/**
 * Indexing is opt-in twice over: the portfolio must be PUBLIC *and* the owner must have allowed
 * search engines. Because the metadata is derived from the published document, a portfolio that
 * cannot be read produces `noindex` as well — a 404 is not something to invite a crawler to.
 */
export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { slug } = await params
  /*
   * The **visitor's** language, from `?lang=`, exactly as the page itself resolves it.
   *
   * A shared page's preview card is read by whoever the link was sent to, so the fallback title and
   * description have to be in their language rather than the owner's. The portfolio's own name and
   * description are the owner's words and are never translated.
   */
  const locale = await resolvePublicLocale(await searchParams)
  const [view, t] = await Promise.all([
    readPublicShare(slug).catch(() => null),
    getTranslations({ locale, namespace: "metadata" }),
  ])
  if (!view) {
    return { title: t("shared.notAvailable"), robots: { index: false, follow: false } }
  }

  const { portfolio } = view
  // Only what the owner published. A description built from a withheld figure would leak it into a
  // search result and a chat preview, which are the two places nobody re-checks the privacy of.
  const description =
    portfolio.description ??
    (portfolio.ownerDisplayName
      ? t("shared.describedBy", { name: portfolio.ownerDisplayName })
      : t("shared.defaultDescription"))

  return {
    title: portfolio.displayName,
    description,
    alternates: {
      canonical: `${SITE_URL}/p/${slug}`,
      /*
       * `hreflang`, so a crawler that finds one language knows the other exists and does not treat
       * them as duplicate content. Only on this route: `/share/` and `/snapshot/` are `noindex`, and
       * telling a crawler about alternates of a page it must not index would be contradictory.
       */
      languages: Object.fromEntries(
        SUPPORTED_LOCALES.map((code) => [code, `${SITE_URL}/p/${slug}?lang=${code}`]),
      ),
    },
    // The published document does not carry the indexing flag — it is a property of the share, and
    // the crawler directive is set from the row that was read, below.
    robots: { index: view.indexable, follow: view.indexable },
    openGraph: {
      title: portfolio.displayName,
      description,
      url: `${SITE_URL}/p/${slug}`,
      siteName: "Stockly",
      type: "profile",
    },
    twitter: { card: "summary", title: portfolio.displayName, description },
  }
}

export default async function PublicPortfolioPage({ params, searchParams }: Params) {
  const { slug } = await params
  const [view, locale] = await Promise.all([
    readPublicShare(slug),
    resolvePublicLocale(await searchParams),
  ])
  if (!view) return <Unavailable reason="PRIVATE" locale={locale} />

  return <PublicPortfolioView portfolio={view.portfolio} asOf={view.publishedAt} locale={locale} />
}
