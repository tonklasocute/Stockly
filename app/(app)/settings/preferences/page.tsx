import type { Metadata } from "next"
import Link from "next/link"
import { PreferencesForm } from "@/features/personalization/components/preferences-form"
import { TagManager } from "@/features/personalization/components/tag-manager"
import { listPortfolios } from "@/features/portfolios/queries"
import { listTags, loadPreferences } from "@/features/personalization/queries"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("preferences") }
}

/** The nonce-based CSP needs a server-rendered response; a prerendered page carries no nonce. */
export const dynamic = "force-dynamic"

/**
 * Personalization lives here rather than on the dashboard it configures.
 *
 * The dashboard is where somebody looks at their money; a row of edit affordances on it would be an
 * administration console wearing a portfolio's clothes. Configuration is a thing you come to do,
 * and then leave.
 */
export default async function PreferencesPage() {
  const tNav = await getTranslations("navigation")
  const t = await getTranslations("settings")
  const [portfolios, preferences, tags] = await Promise.all([
    listPortfolios(),
    loadPreferences(),
    listTags(),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("preferences")}</h1>
        <p className="text-muted-foreground text-sm">
          How Stockly looks and what it shows you. None of this changes a single figure —{" "}
          <Link href="/settings" className="underline underline-offset-4">{t("portfoliosInSettings")}</Link>
          .
        </p>
      </header>

      <PreferencesForm
        portfolios={portfolios}
        initial={{
          theme: preferences.theme,
          density: preferences.density,
          defaultPortfolioId: preferences.defaultPortfolioId,
          favoriteMetrics: preferences.favoriteMetrics,
          dashboardLayout: preferences.dashboardLayout,
          dismissedInsights: preferences.dismissedInsights,
        }}
      />

      <TagManager tags={tags} />
    </div>
  )
}
