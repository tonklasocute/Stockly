import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight, TrendingDown, TrendingUp } from "lucide-react"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Delta, Percent } from "@/components/value"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { AllocationChart } from "@/features/dashboard/components/allocation-chart"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { loadPortfolioView } from "@/features/portfolios/portfolio-view"
import { formatCurrency } from "@/lib/format"
import { NoPortfolio } from "../_no-portfolio"

export const metadata: Metadata = { title: "Dashboard" }

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>
}) {
  const { p } = await searchParams
  const { active } = await resolveActivePortfolio(p)
  if (!active) return <NoPortfolio />

  const { holdings, summary, transactions } = await loadPortfolioView(active.id)
  const currency = active.currency
  const ranked = [...holdings].sort((a, b) => b.returnPct - a.returnPct)
  const best = ranked[0]
  const worst = ranked.length > 1 ? ranked[ranked.length - 1] : undefined

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Dashboard</h1>
          <p className="text-muted-foreground text-sm">{active.name}</p>
        </div>
        <Button
          render={<Link href={`/transactions?p=${active.id}`} />}
          variant="outline"
          size="sm"
          className="gap-1.5"
        >
          Transactions
          <ArrowRight className="size-3.5" aria-hidden />
        </Button>
      </div>

      {transactions.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={TrendingUp}
            title="Nothing to show yet"
            description="Add your first transaction and your portfolio value, cost basis and profit and loss appear here."
            action={
              <Button
                render={<Link href={`/transactions?p=${active.id}`} />}
                className="gap-2 max-sm:h-11"
              >
                Add a transaction
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <StatGrid>
            <StatCard
              label="Portfolio value"
              value={formatCurrency(summary.marketValue, currency)}
              emphasis
              hint={<Delta value={summary.unrealizedPnl} currency={currency} percent={summary.returnPct} />}
            />
            <StatCard label="Invested" value={formatCurrency(summary.investedValue, currency)} emphasis />
            <StatCard
              label="Unrealized P&L"
              value={<Delta value={summary.unrealizedPnl} currency={currency} />}
              emphasis
              hint={<Percent value={summary.returnPct} />}
            />
            <StatCard
              label="Realized P&L"
              value={<Delta value={summary.realizedPnl} currency={currency} />}
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {summary.holdingsCount} holding{summary.holdingsCount === 1 ? "" : "s"}
                </span>
              }
            />
          </StatGrid>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="bg-card rounded-xl border p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold">Allocation</h2>
              {holdings.length ? (
                <AllocationChart holdings={holdings} currency={currency} />
              ) : (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No open positions to allocate.
                </p>
              )}
            </section>

            <section className="bg-card rounded-xl border p-4 sm:p-5">
              <h2 className="mb-4 text-sm font-semibold">Performance</h2>
              {best ? (
                <div className="grid gap-3">
                  {[
                    { label: "Best performer", holding: best, icon: TrendingUp },
                    ...(worst ? [{ label: "Worst performer", holding: worst, icon: TrendingDown }] : []),
                  ].map(({ label, holding, icon: Icon }) => (
                    <div
                      key={label}
                      className="bg-muted/40 flex items-center gap-3 rounded-lg px-3 py-2.5"
                    >
                      <Icon
                        className={label === "Best performer" ? "text-gain size-4" : "text-loss size-4"}
                        aria-hidden
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-muted-foreground text-xs">{label}</p>
                        <p className="font-medium">{holding.symbol}</p>
                      </div>
                      <div className="text-right">
                        <Percent value={holding.returnPct} />
                        <p className="text-muted-foreground tabular text-xs">
                          {formatCurrency(holding.marketValue, currency)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground py-8 text-center text-sm">
                  No open positions yet.
                </p>
              )}
            </section>
          </div>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Top holdings</h2>
              <Link
                href={`/portfolio?p=${active.id}`}
                className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 hover:underline"
              >
                View all
              </Link>
            </div>
            <ul className="divide-y overflow-hidden rounded-xl border">
              {holdings.slice(0, 5).map((h) => (
                <li key={h.symbol} className="bg-card flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{h.symbol}</p>
                    <p className="text-muted-foreground tabular text-xs">
                      {h.quantity} @ {formatCurrency(h.averageCost, currency)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular font-medium">{formatCurrency(h.marketValue, currency)}</p>
                    <Delta value={h.unrealizedPnl} currency={currency} percent={h.returnPct} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
