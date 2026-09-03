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
import { TrackRecent } from "@/features/personalization/components/track-recent"
import { FundamentalsPanel } from "@/features/fundamentals/components/fundamentals-panel"
import { loadFundamentals } from "@/features/fundamentals/loader"
import { NewsList } from "@/features/news/components/news-list"
import { loadSymbolNews } from "@/features/news/loader"
import { getTranslations } from "next-intl/server"

type Props = {
  params: Promise<{ symbol: string }>
  searchParams: Promise<{ p?: string; market?: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { symbol } = await params
  return { title: normalizeSymbol(symbol) || "Stock" }
}

export default async function StockPage({ params, searchParams }: Props) {
  const t = await getTranslations("stocks")
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
      return error instanceof Error ? error : new Error(t("marketDataUnavailable"))
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

  /*
   * Company fundamentals.
   *
   * The price is passed in rather than re-fetched: the quote call above already paid for it, and a
   * second one would spend a provider credit to learn something this function is holding. It
   * degrades on its own — a provider with no fundamentals costs this section and nothing else.
   */
  const fundamentals = await loadFundamentals(symbol, market, quote?.price ?? null).catch(() => null)

  /*
   * News for this instrument, with its corporate events passed in so an article can be related to
   * one. The event stays the source of truth — a link only says the two are probably about the
   * same thing, and carries the confidence that judgement was made with.
   */
  const news = await loadSymbolNews(
    symbol,
    market,
    (fundamentals?.events ?? []).map((event) => ({
      symbol: event.symbol,
      market: event.market,
      type: event.type,
      date: event.date,
    })),
  ).catch(() => null)

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
      {/* Renders nothing. Records that this page was opened, so it can be reached again. */}
      <TrackRecent kind="stock" refId={symbolKey(symbol, market)} label={symbol} />
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
        <h2 className="sr-only">{t("page.priceHistory")}</h2>
        <PriceChart symbol={symbol} market={market} currency={currency} />
      </section>

      <section className="bg-card rounded-xl border p-4 sm:p-5">
        <h2 className="mb-4 text-sm font-semibold">{t("page.technicalOverview")}</h2>
        <TechnicalPanel symbol={symbol} market={market} currency={currency} />

        {/*
          Fundamentals below the technicals: one describes what the price has been doing, the other
          what the business reported. Neither is an input to the position above it.
        */}
        {fundamentals && <FundamentalsPanel data={fundamentals} />}

        {news && <NewsList data={news} title={t("page.news")} description={`Recent coverage of ${symbol}`} />}
      </section>

      {active && (
        <section className="bg-card rounded-xl border p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-semibold">{t("page.thesis")}</h2>
          <p className="text-muted-foreground mb-4 text-xs">{t("page.thesisHint")}</p>
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
          <h2 className="mb-1 text-sm font-semibold">{t("page.journal")}</h2>
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
        <h2 className="mb-4 text-sm font-semibold">{t("page.ai")}</h2>
        <StockAIPanel symbol={symbol} enabled={isAIEnabled()} />
      </section>

      <section className="bg-card rounded-xl border p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-semibold">{t("page.alerts")}</h2>
        <p className="text-muted-foreground mb-4 text-xs">{t("page.alertsHint")}</p>
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
        <h2 className="mb-4 text-sm font-semibold">{t("page.position")}</h2>
        {position ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <div className="space-y-0.5">
                <dt className="text-muted-foreground text-xs">{t("page.shares")}</dt>
                <dd className="tabular text-sm font-medium">{formatQuantity(position.quantity)}</dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-muted-foreground text-xs">{t("page.averageCost")}</dt>
                <dd className="tabular text-sm font-medium">
                  {formatCurrency(position.averageCost, currency)}
                </dd>
              </div>
              <div className="space-y-0.5">
                <dt className="text-muted-foreground text-xs">{t("page.marketValue")}</dt>
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
                <dt className="text-muted-foreground text-xs">{t("page.unrealizedPnl")}</dt>
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
            <p className="text-muted-foreground text-sm">{t("page.notOwned")}</p>
            {active && (
              <Button
                nativeButton={false}
                render={<Link href={`/transactions?p=${active.id}`} />}
                variant="outline"
                size="sm"
              >{t("page.recordTransaction")}</Button>
            )}
          </div>
        )}
      </section>

      {quote && (
        <section className="bg-card rounded-xl border p-4 sm:p-5">
          <h2 className="mb-4 text-sm font-semibold">{t("page.overview")}</h2>
          <StockOverview quote={quote} />
        </section>
      )}

      {profile && <CompanyProfileCard profile={profile} />}
    </div>
  )
}
