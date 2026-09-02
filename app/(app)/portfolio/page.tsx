import type { Metadata } from "next"
import Link from "next/link"
import { FlaskConical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Delta, Percent } from "@/components/value"
import { HoldingsTable } from "@/features/portfolios/components/holdings-table"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { loadPortfolioView, namesFrom } from "@/features/portfolios/portfolio-view"
import { CurrencyExposure, CurrencyNotice, TranslationNote } from "@/components/currency-exposure"
import { baseCurrencyOf } from "@/domain/market"
import { formatCurrency, formatCurrencyWithCode } from "@/lib/format"
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

  const { holdings, summary, quotes, marketDataError, missingFxPairs } = await loadPortfolioView(
    active.id,
  )
  const currency = baseCurrencyOf(active.currency)
  const names = namesFrom(quotes)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Portfolio</h1>
          <p className="text-muted-foreground text-sm">{active.name}</p>
        </div>
        {/*
          The what-if scratchpad. It restates this portfolio at prices and quantities the user
          types, creates nothing, and is discarded by a Reset button — which is what makes it worth
          experimenting in.
        */}
        <Button
          nativeButton={false}
          render={<Link href={`/simulations?p=${active.id}`} />}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          <FlaskConical className="size-3.5" aria-hidden />
          What-if
        </Button>
      </div>

      {marketDataError && (
        <Alert>
          <AlertDescription>
            {marketDataError} Holdings are valued at cost until prices return.
          </AlertDescription>
        </Alert>
      )}

      <CurrencyNotice summary={summary} missingFxPairs={missingFxPairs} />

      <StatGrid>
        <StatCard
          label="Portfolio value"
          value={formatCurrencyWithCode(summary.marketValue, currency)}
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

      <CurrencyExposure summary={summary} />

      <HoldingsTable holdings={holdings} currency={currency} names={names} />

      <TranslationNote summary={summary} />
    </div>
  )
}
