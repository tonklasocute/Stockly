import type { Metadata } from "next"
import { projectPublicPortfolio } from "@/domain/sharing"
import { PublicPortfolioView } from "@/features/sharing/components/public-portfolio-view"
import { SharingSettings } from "@/features/sharing/components/sharing-settings"
import { loadIntelligence } from "@/features/intelligence/loader"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import {
  listShareLinks,
  listSnapshots,
  loadPublished,
  loadShare,
  toConfig,
} from "@/features/sharing/queries"
import { toShareSource } from "@/features/sharing/source"
import { Section } from "@/components/metric"
import { SITE_URL } from "@/lib/site"
import { NoPortfolio } from "../_no-portfolio"
import { appLocale } from "@/lib/i18n/server"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("sharing") }
}

/** The nonce-based CSP needs a server-rendered response; a prerendered page has no nonce. */
export const dynamic = "force-dynamic"

/**
 * Sharing settings, and — below them — the page itself.
 *
 * **The preview is the real thing.** It is produced by `projectPublicPortfolio` from today's
 * figures and the settings as saved, then handed to the same component the public route renders. A
 * preview drawn by separate code could be wrong about what a stranger sees, and that is the one
 * mistake this screen exists to prevent.
 *
 * It previews the *saved* settings rather than the unsaved form state, deliberately: what a visitor
 * can see is what has been published, and showing an optimistic preview of switches nobody has
 * committed would answer a different question than the one being asked.
 */
export default async function SharingPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const tNav = await getTranslations("navigation")
  const t = await getTranslations("sharing")
  const locale = await appLocale()
  const { p } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const [row, links, snapshots, published, bundle] = await Promise.all([
    loadShare(active.id),
    listShareLinks(active.id),
    listSnapshots(active.id),
    loadPublished(active.id),
    loadIntelligence(active.id),
  ])

  const config = toConfig(row)
  const preview = projectPublicPortfolio(toShareSource(bundle, active.name), config)
  const publishedIsStale =
    published !== null && row !== null && published.settings_version !== row.settings_version

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{tNav("sharing")}</h1>
        <p className="text-muted-foreground text-sm">
          Share {active.name} without sharing everything. Your transactions, journal, theses and
          notes are never included.
        </p>
      </header>

      <SharingSettings
        portfolioId={active.id}
        initialConfig={config}
        links={links}
        snapshots={snapshots}
        publishedAt={published?.published_at ?? null}
        origin={SITE_URL}
      />

      <Section
        title={t("preview")}
        description={
          publishedIsStale
            ? "Your saved settings are newer than what visitors currently see. Save and publish to update them."
            : "Exactly what a visitor sees, rendered by the same code as the public page."
        }
      >
        <div className="bg-muted/30 -mx-4 -mb-4 rounded-b-xl border-t sm:-mx-5 sm:-mb-5">
          <PublicPortfolioView
            portfolio={preview}
            asOf={published?.published_at ?? new Date().toISOString()}
            locale={locale}
          />
        </div>
      </Section>
    </div>
  )
}
