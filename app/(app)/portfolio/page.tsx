import type { Metadata } from "next"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Delta, Percent } from "@/components/value"
import { HoldingsTable } from "@/features/portfolios/components/holdings-table"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { loadPortfolioView } from "@/features/portfolios/portfolio-view"
import { formatCurrency } from "@/lib/format"
import { mockCompanyName } from "@/services/market-data/mock-provider"
import { NoPortfolio } from "../_no-portfolio"

export const metadata: Metadata = { title: "Portfolio" }

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const { p } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const { holdings, summary } = await loadPortfolioView(active.id)
  const currency = active.currency
  const names = Object.fromEntries(holdings.map((h) => [h.symbol, mockCompanyName(h.symbol)]))

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Portfolio</h1>
        <p className="text-muted-foreground text-sm">{active.name}</p>
      </div>

      <StatGrid>
        <StatCard
          label="Portfolio value"
          value={formatCurrency(summary.marketValue, currency)}
          emphasis
        />
        <StatCard label="Invested" value={formatCurrency(summary.investedValue, currency)} emphasis />
        <StatCard
          label="Unrealized P&L"
          value={<Delta value={summary.unrealizedPnl} currency={currency} />}
          emphasis
        />
        <StatCard label="Return" value={<Percent value={summary.returnPct} />} emphasis />
      </StatGrid>

      <HoldingsTable holdings={holdings} currency={currency} names={names} />
    </div>
  )
}
