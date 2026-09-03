import type { Metadata } from "next"
import Link from "next/link"
import { DataHealth } from "@/features/portfolios/components/data-health"
import { PortfolioManager } from "@/features/portfolios/components/portfolio-manager"
import { listPortfolios } from "@/features/portfolios/queries"
import { baseCurrencyOf } from "@/domain/market"
import { loadAllFxRates } from "@/services/fx"
import { getMarketStatuses } from "@/services/market-data"
import { APP_VERSION } from "@/lib/version"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("settings") }
}

export default async function SettingsPage() {
  const tNav = await getTranslations("navigation")
  const tLegal = await getTranslations("legal")
  const t = await getTranslations("settings")
  const portfolios = await listPortfolios()
  // The first portfolio's base currency is the one worth reporting rates against; a user with no
  // portfolio yet still sees market status, which is the half that does not depend on one.
  const baseCurrency = baseCurrencyOf(portfolios[0]?.currency)

  // Neither can take the page down: both degrade to "unavailable", which is what they mean.
  const [statuses, fx] = await Promise.all([
    getMarketStatuses().catch(() => null),
    loadAllFxRates(baseCurrency).catch(() => null),
  ])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("settings")}</h1>
        <p className="text-muted-foreground text-sm">{t("managePortfolios")}</p>
      </div>
      <PortfolioManager portfolios={portfolios} />

      {statuses && fx && (
        <div className="border-t pt-6">
          <DataHealth baseCurrency={baseCurrency} statuses={statuses} fx={fx} />
        </div>
      )}

      <section className="space-y-3 border-t pt-6">
        <h2 className="text-sm font-semibold">{t("about")}</h2>
        <p className="text-muted-foreground text-xs">
          Stockly {APP_VERSION}. Market data may be delayed or incomplete, and nothing here is
          personalised financial advice.
        </p>
        <nav className="text-muted-foreground flex flex-wrap gap-4 text-xs">
          <Link href="/terms" className="hover:text-foreground underline-offset-4 hover:underline">
            {tLegal("nav.terms")}
          </Link>
          <Link href="/privacy" className="hover:text-foreground underline-offset-4 hover:underline">
            {tLegal("nav.privacy")}
          </Link>
          <Link href="/disclaimer" className="hover:text-foreground underline-offset-4 hover:underline">
            {tLegal("nav.disclaimer")}
          </Link>
        </nav>
      </section>
    </div>
  )
}
