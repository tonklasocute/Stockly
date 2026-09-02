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
import { StockAIPanel } from "@/features/ai/components/stock-ai-panel"
import { TechnicalPanel } from "@/features/technical/components/technical-panel"
import { QuickAlert } from "@/features/alerts/components/quick-alert"
import { listAlerts } from "@/features/alerts/queries"
import { WatchButton } from "@/features/watchlist/components/watch-button"
import { watchedSymbols } from "@/features/watchlist/queries"
import { resolveActivePortfolio } from "@/features/portfolios/queries"
import { loadPortfolioView } from "@/features/portfolios/portfolio-view"
import { findThesis } from "@/features/theses/queries"
import { listJournalForInstrument } from "@/features/journal/queries"
import { ThesisPanel } from "@/features/theses/components/thesis-panel"
import { PositionJournal } from "@/features/journal/components/position-journal"
import { thesisObservations } from "@/domain/research"
import { MarketBadge } from "@/components/market-badge"
import {
  formatCurrency,
  formatOptionalCurrency,
  formatOptionalPercent,
  formatQuantity,
} from "@/lib/format"
import { currencyOf, isValidSymbol, marketOf, normalizeSymbol, symbolKey, toMarket } from "@/domain/market"
import { isAIEnabled } from "@/services/ai"
import { getMarketDataProvider, isMarketDataError } from "@/services/market-data"
import type { CompanyProfile, Quote } from "@/services/market-data/types"

type Props = {
  params: Promise<{ symbol: string }>
  searchParams: Promise<{ p?: string; market?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params
  return { title: normalizeSymbol(symbol) || "Stock" }
}

export default async function StockPage({ params, searchParams }: Props) {
  const { symbol: raw } = await params
  const query = await searchParams
  // The market comes from the URL, not from the symbol: "PTT" is only unambiguous once you know
  // which exchange it was looked up on, and guessing would price it in the wrong currency.
  const market = toMarket(query.market)
  if (!isValidSymbol(raw, market)) notFound()
  const symbol = normalizeSymbol(raw)

  // Selecting a provider can throw — an unconfigured key, or a market with no adapter — and that
  // must cost the price header, not the page. Everything else here (your position, alerts, the
  // watchlist star) comes from the database and is still worth rendering.
  const provider = (() => {
    try {
      return getMarketDataProvider(market)
    } catch (error: unknown) {
      return error instanceof Error ? error : new Error("Market data is unavailable.")
    }
  })()
  const unavailable = provider instanceof Error

  // One round trip for everything the page needs; a failure in any one part must not blank the page.
  const [quoteResult, profileResult, watched, { active }, alerts] = await Promise.all([
    unavailable ? Promise.resolve(provider) : provider.getQuote(symbol, market).catch((error: unknown) => error),
    unavailable ? Promise.resolve(null) : provider.getCompanyProfile(symbol, market).catch(() => null),
    watchedSymbols(),
    resolveActivePortfolio(query.p),
    listAlerts().catch(() => []),
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
    ? (await loadPortfolioView(active.id)).holdings.find(
        (h) => h.symbol === symbol && h.market === market,
      )
    : undefined

  // The user's own reasoning about this instrument. Two reads, both RLS-scoped, and neither one an
  // input to any figure above — a thesis cannot move a cost basis.
  const [thesis, journalEntries] = active
    ? await Promise.all([
        findThesis(active.id, symbol, market).catch(() => null),
        listJournalForInstrument(active.id, symbol, market).catch(() => []),
      ])
    : [null, []]

  const name = profile?.name ?? quote?.name ?? symbol
  const exchange = profile?.exchange ?? quote?.exchange ?? marketOf(market).exchanges[0]
  /**
   * The instrument's own currency, from the market registry rather than from the provider: the
   * registry is the value every stored number was computed against, and a provider disagreeing
   * with it would silently relabel prices the portfolio engine has already used.
   */
  const currency = currencyOf(market)
  const baseCurrency = position?.baseCurrency ?? currency

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <div>
            <h1 className="truncate text-xl font-semibold tracking-tight sm:text-2xl">{name}</h1>
            <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
              <span>
                {symbol}
                {exchange ? ` · ${exchange}` : ""}
              </span>
              <MarketBadge market={market} currency={currency} />
            </p>
          </div>
          <LiveQuote symbol={symbol} market={market} initialQuote={quote} currency={currency} />
        </div>

        <WatchButton
          symbol={symbol}
          market={market}
          name={name}
          exchange={exchange ?? null}
          watched={watched.has(symbolKey(symbol, market))}
        />
      </div>

      {marketDataError && (
        <Alert>
          <AlertDescription>{marketDataError}</AlertDescription>
        </Alert>
      )}

      <section className="bg-card rounded-xl border p-4 sm:p-5">
        <h2 className="sr-only">Price history</h2>
        <PriceChart symbol={symbol} market={market} currency={currency} />
      </section>

      <section className="bg-card rounded-xl border p-4 sm:p-5">
        <h2 className="mb-4 text-sm font-semibold">Technical overview</h2>
        <TechnicalPanel symbol={symbol} market={market} currency={currency} />
      </section>

      {active && (
        <section className="bg-card rounded-xl border p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-semibold">Investment thesis</h2>
          <p className="text-muted-foreground mb-4 text-xs">
            Why you own this, and what would change your mind. Only you set the status.
          </p>
          <ThesisPanel
            portfolioId={active.id}
            symbol={symbol}
            market={market}
            thesis={thesis}
            observations={
              thesis
                ? thesisObservations(
                    {
                      returnPct: position?.returnPct ?? null,
                      weightPct: position?.weight ?? null,
                      quantity: position?.quantity ?? 0,
                      updatedAt: thesis.updated_at,
                    },
                    new Date(),
                  )
                : []
            }
          />
        </section>
      )}

      {active && (
        <section className="bg-card rounded-xl border p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-semibold">Journal</h2>
          <p className="text-muted-foreground mb-4 text-xs">
            Notes about {symbol}, newest first.
          </p>
          <PositionJournal
            portfolioId={active.id}
            symbol={symbol}
            market={market}
            entries={journalEntries}
          />
        </section>
      )}

      <section className="bg-card rounded-xl border p-4 sm:p-5">
        <h2 className="mb-4 text-sm font-semibold">Stockly AI</h2>
        <StockAIPanel symbol={symbol} enabled={isAIEnabled()} />
      </section>

      <section className="bg-card rounded-xl border p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold">Alerts</h2>
        <p className="text-muted-foreground mb-4 text-xs">
          Checked on the server every few minutes, so they fire whether or not Stockly is open.
        </p>
        <QuickAlert
          symbol={symbol}
          market={market}
          currency={currency}
          price={quote?.price ?? null}
          portfolioId={active?.id}
          existing={alerts}
        />
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
                {baseCurrency !== currency && (
                  <dd className="text-muted-foreground tabular text-xs">
                    ≈ {formatOptionalCurrency(position.baseMarketValue, baseCurrency)}
                  </dd>
                )}
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
              {formatOptionalPercent(position.weight, { signed: false })} of {active?.name}
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
