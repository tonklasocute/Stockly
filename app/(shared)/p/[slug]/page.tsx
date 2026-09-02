import type { Metadata } from "next"
import { PublicPortfolioView } from "@/features/sharing/components/public-portfolio-view"
import { Unavailable } from "@/features/sharing/components/unavailable"
import { readPublicShare } from "@/features/sharing/public"
import { SITE_URL } from "@/lib/site"

/**
 * A public portfolio, at the address its owner chose.
 *
 * The anonymous Supabase role can select from `published_shares` only where visibility is PUBLIC,
 * so a LINK_ONLY or PRIVATE portfolio at a guessed slug returns nothing here — the restriction is
 * the database's, not this file's.
 */
type Params = { params: Promise<{ slug: string }> }

/**
 * Indexing is opt-in twice over: the portfolio must be PUBLIC *and* the owner must have allowed
 * search engines. Because the metadata is derived from the published document, a portfolio that
 * cannot be read produces `noindex` as well — a 404 is not something to invite a crawler to.
 */
export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const view = await readPublicShare(slug).catch(() => null)
  if (!view) return { title: "Not available", robots: { index: false, follow: false } }

  const { portfolio } = view
  // Only what the owner published. A description built from a withheld figure would leak it into a
  // search result and a chat preview, which are the two places nobody re-checks the privacy of.
  const description =
    portfolio.description ??
    `A portfolio shared on Stockly${portfolio.ownerDisplayName ? ` by ${portfolio.ownerDisplayName}` : ""}.`

  return {
    title: portfolio.displayName,
    description,
    alternates: { canonical: `${SITE_URL}/p/${slug}` },
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

export default async function PublicPortfolioPage({ params }: Params) {
  const { slug } = await params
  const view = await readPublicShare(slug)
  if (!view) return <Unavailable reason="PRIVATE" />

  return <PublicPortfolioView portfolio={view.portfolio} asOf={view.publishedAt} />
}
