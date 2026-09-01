import type { Metadata } from "next"
import { PortfolioManager } from "@/features/portfolios/components/portfolio-manager"
import { listPortfolios } from "@/features/portfolios/queries"

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
    </div>
  )
}
