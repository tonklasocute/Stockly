import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Delta, Percent } from "@/components/value"
import { CompanyProfileCard } from "@/features/stocks/components/company-profile-card"
import { LiveQuote } from "@/features/stocks/components/live-quote"
import { PriceChart } from "@/features/stocks/components/lazy-price-chart"
import { StockOverview } from "@/features/stocks/components/stock-overview"
import { WatchButton } from "@/features/watchlist/components/watch-button"
import { watchedSymbols } from "@/features/watchlist/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { loadPortfolioView } from "@/features/portfolios/portfolio-view"
import { formatCurrency, formatQuantity } from "@/lib/format"
import { isValidSymbol, normalizeSymbol } from "@/lib/symbol"
import { getMarketDataProvider, isMarketDataError } from "@/services/market-data"
import type { CompanyProfile, Quote } from "@/services/market-data/types"

type Props = { params: Promise<{ symbol: string }>; searchParams: Promise<{ p?: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params
  return { title: normalizeSymbol(symbol) || "Stock" }
}

export default async function StockPage({ params, searchParams }: Props) {
  const { symbol: raw } = await params
  if (!isValidSymbol(raw)) notFound()
  const symbol = normalizeSymbol(raw)

  const provider = getMarketDataProvider()

  // One round trip for everything the page needs; a failure in any one part must not blank the page.
  const [quoteResult, profileResult, watched, { active }] = await Promise.all([
    provider.getQuote(symbol).catch((error: unknown) => error),
    provider.getCompanyProfile(symbol).catch(() => null),
    watchedSymbols(),
    resolveActivePortfolio((await searchParams).p),
  ])

  const marketDataError =
    quoteResult instanceof Error
      ? isMarketDataError(quoteResult)
        ? quoteResult.message
        : "Unable to load market data. Please try again later."
      : null
  const quote = quoteResult instanceof Error ? null : (quoteResult as Quote | null)
  const profile = profileResult as CompanyProfile | null

  // A symbol with neither a quote nor a profile does not exist as far as this app is concerned.
  if (!quote && !profile && !marketDataError) notFound()

  const position = active
    ? (await loadPortfolioView(active.id)).holdings.find((h) => h.symbol === symbol)
    : undefined

  const name = profile?.name ?? quote?.name ?? symbol
  const exchange = profile?.exchange ?? quote?.exchange
  const currency = quote?.currency ?? "USD"

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div>
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{name}</h1>
            <p className="text-muted-foreground text-sm">
              {symbol}
              {exchange ? ` · ${exchange}` : ""}
            </p>
          </div>
          <LiveQuote symbol={symbol} initialQuote={quote} currency={currency} />
        </div>

        <WatchButton
          symbol={symbol}
          name={name}
          exchange={exchange ?? null}
          watched={watched.has(`US:${symbol}`)}
        />
      </div>

      {marketDataError && (
        <Alert>
          <AlertDescription>{marketDataError}</AlertDescription>
        </Alert>
      )}

      <section className="bg-card rounded-xl border p-4 sm:p-5">
        <h2 className="sr-only">Price history</h2>
        <PriceChart symbol={symbol} currency={currency} />
      </section>

      <section className="bg-card rounded-xl border p-4 sm:p-5">
        <h2 className="mb-4 text-sm font-semibold">Your position</h2>
        {position ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <div className="space-y-0.5">
                <dt className="text-muted-foreground text-xs">Shares</dt>
                <dd className="tabular text-sm font-medium">{formatQuantity(position.quantity)}</dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-muted-foreground text-xs">Average cost</dt>
                <dd className="tabular text-sm font-medium">
                  {formatCurrency(position.averageCost, currency)}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-muted-foreground text-xs">Market value</dt>
                <dd className="tabular text-sm font-medium">
                  {formatCurrency(position.marketValue, currency)}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-muted-foreground text-xs">Unrealized P&amp;L</dt>
                <dd className="text-sm">
                  <Delta value={position.unrealizedPnl} currency={currency} />
                </dd>
              </div>
            </dl>
            <p className="text-muted-foreground mt-3 text-xs">
              <Percent value={position.returnPct} /> return ·{" "}
              {position.weight.toFixed(2)}% of {active?.name}
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-sm">You don&apos;t own this stock.</p>
            {active && (
              <Button
                nativeButton={false}
                render={<Link href={`/transactions?p=${active.id}`} />}
                variant="outline"
                size="sm"
              >
                Record a transaction
              </Button>
            )}
          </div>
        )}
      </section>

      {quote && (
        <section className="bg-card rounded-xl border p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold">Overview</h2>
          <StockOverview quote={quote} />
        </section>
      )}

      {profile && <CompanyProfileCard profile={profile} />}
    </div>
  )
}
