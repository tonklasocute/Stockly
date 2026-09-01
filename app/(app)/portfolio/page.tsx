import type { Metadata } from "next"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Delta, Percent } from "@/components/value"
import { HoldingsTable } from "@/features/portfolios/components/holdings-table"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { loadPortfolioView, namesFrom } from "@/features/portfolios/portfolio-view"
import { formatCurrency } from "@/lib/format"
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

  const { holdings, summary, quotes, marketDataError } = await loadPortfolioView(active.id)
  const currency = active.currency
  const names = namesFrom(quotes)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Portfolio</h1>
        <p className="text-muted-foreground text-sm">{active.name}</p>
      </div>

      {marketDataError && (
        <Alert>
          <AlertDescription>
            {marketDataError} Holdings are valued at cost until prices return.
          </AlertDescription>
        </Alert>
      )}

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
        <StatCard
          label="Today"
          value={
            summary.todayPnl === null ? (
              <span className="text-muted-foreground text-lg">N/A</span>
            ) : (
              <Delta value={summary.todayPnl} currency={currency} />
            )
          }
          emphasis
          hint={summary.todayReturnPct === null ? undefined : <Percent value={summary.todayReturnPct} />}
        />
      </StatGrid>

      <HoldingsTable holdings={holdings} currency={currency} names={names} />
    </div>
  )
}
