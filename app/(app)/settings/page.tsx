import type { Metadata } from "next"
import Link from "next/link"
import { PortfolioManager } from "@/features/portfolios/components/portfolio-manager"
import { listPortfolios } from "@/features/portfolios/queries"
import { APP_VERSION } from "@/lib/version"

export const metadata: Metadata = { title: "Settings" }

export default async function SettingsPage() {
  const portfolios = await listPortfolios()

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Settings</h1>
        <p className="text-muted-foreground text-sm">Manage your portfolios.</p>
      </div>
      <PortfolioManager portfolios={portfolios} />

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
