import type { Metadata } from "next"
import Link from "next/link"
import { DataHealth } from "@/features/portfolios/components/data-health"
import { PortfolioManager } from "@/features/portfolios/components/portfolio-manager"
import { listPortfolios } from "@/features/portfolios/queries"
import { baseCurrencyOf } from "@/domain/market"
import { loadAllFxRates } from "@/services/fx"
import { getMarketStatuses } from "@/services/market-data"
import { APP_VERSION } from "@/lib/version"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
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
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your portfolios.</p>
      </div>
      <PortfolioManager portfolios={portfolios} />

      {statuses && fx && (
        <div className="border-t pt-6">
          <DataHealth baseCurrency={baseCurrency} statuses={statuses} fx={fx} />
        </div>
      )}

      <section className="space-y-3 border-t pt-6">
        <h2 className="text-sm font-semibold">About</h2>
        <p className="text-muted-foreground text-xs">
          Stockly {APP_VERSION}. Market data may be delayed or incomplete, and nothing here is
          personalised financial advice.
        </p>
        <nav className="text-muted-foreground flex flex-wrap gap-4 text-xs">
          <Link href="/terms" className="hover:text-foreground underline-offset-4 hover:underline">
            Terms
          </Link>
          <Link href="/privacy" className="hover:text-foreground underline-offset-4 hover:underline">
            Privacy
          </Link>
          <Link href="/disclaimer" className="hover:text-foreground underline-offset-4 hover:underline">
            Disclaimer
          </Link>
        </nav>
      </section>
    </div>
  )
}
