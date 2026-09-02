import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  assessCompleteness,
  summarizeHistory,
  type AIIntent,
  type DataCompleteness,
  type HistorySummary,
} from "@/domain/ai"
import {
  analyze,
  scoreTechnicals,
  SIGNAL_LABELS,
  type ScoreComponent,
  type TechnicalSnapshot,
} from "@/domain/technical"

import {
  matchesFilter,
  readMetric,
  METRIC_LABELS,
  OPERATOR_LABELS,
  SCREENER_PRESETS,
  type ScreenerDefinition,
  type ScreenerMetric,
} from "@/domain/screener"
import { loadAnalytics } from "@/features/analytics/portfolio-analytics"
import { loadPortfolioView } from "@/features/portfolios/portfolio-view"
import { readAllSnapshots, readSnapshots, type StoredSnapshot } from "@/features/technical/snapshots"
import { DEFAULT_UNIVERSE } from "@/features/technical/universe"
import { listWatchlist } from "@/features/watchlist/queries"
import { currencyOf, normalizeSymbol, symbolKey, toMarket, type MarketId } from "@/domain/market"
import { getMarketDataProvider, getQuotesFor } from "@/services/market-data"
import type { Database, SavedScreenRow } from "@/types/database"
import type {
  GroundedData,
  MarketFacts,
  PortfolioFacts,
  ScreenExplanation,
  StockFacts,
  WatchlistFacts,
} from "./facts"
import {
  renderMarket,
  renderPortfolio,
  renderScreen,
  renderStock,
  renderWatchlist,
} from "./render"
import { MAX_CONTEXT_CHARS } from "./schema"

export type * from "./facts"
export { renderScreenerVocabulary } from "./render"

/**
 * The context builder — retrieval, then reduction.
 *
 * This is where grounding actually happens. The model is never handed a database, a provider or a
 * tool; it is handed a block of text assembled here from Stockly's own engines, and the response
 * schema gives it nowhere to put a number of its own. Two consequences worth stating:
 *
 * - **Only what the question needs is retrieved.** A question about RSI does not load a portfolio.
 *   That is a privacy rule as much as a cost one — see docs/AI-SECURITY.md.
 * - **Nothing is recomputed for the model.** Prices come from the market-data service, indicators
 *   from the technical snapshot cache, portfolio figures from the portfolio service. If the AI and
 *   the dashboard ever disagreed, one of them would be lying; there is only one source for each.
 */

export type AIContext = {
  intent: AIIntent
  symbols: string[]
  grounded: GroundedData
  completeness: DataCompleteness
  /** The newest timestamp behind any figure in the block — what "data as of" means on screen. */
  dataAsOf: string
  /** True when any indicator in the block is older than the freshness window. */
  delayed: boolean
  /** The rendered text handed to the model. */
  text: string
}

// ---------------------------------------------------------------- the supported universe

/**
 * Every symbol this deployment can answer about: the ones with cached indicators, whatever the
 * caller holds or watches, and the default list the snapshot job already tracks.
 *
 * Symbol validation happens against this set, so a ticker nobody tracks is reported as not found
 * instead of being handed to a model that would cheerfully improvise a price for it. The default
 * list is included so a fresh deployment — where the scheduled job has not run yet — can still
 * answer about the stocks it is configured to follow, fetching the history on demand.
 */
export async function resolveKnownSymbols(
  supabase: SupabaseClient<Database>,
): Promise<Set<string>> {
  const [snapshots, transactions, watchlist] = await Promise.all([
    supabase.from("technical_snapshots").select("symbol").eq("timeframe", "1D"),
    supabase.from("transactions").select("symbol"),
    supabase.from("watchlist_items").select("symbol"),
  ])

  const symbols = new Set<string>(DEFAULT_UNIVERSE)
  for (const rows of [snapshots.data, transactions.data, watchlist.data]) {
    for (const row of rows ?? []) {
      const symbol = normalizeSymbol(row.symbol ?? "")
      if (symbol) symbols.add(symbol)
    }
  }
  return symbols
}

// ---------------------------------------------------------------- per-stock retrieval

/**
 * Which venue a symbol the user typed refers to.
 *
 * A question is plain language — "how is PTT doing?" — and a bare ticker does not identify an
 * instrument once more than one exchange exists. Rather than guess, the market is resolved from the
 * data the user already has a relationship with: what they hold, then what they watch. Only when
 * neither knows the symbol does it fall back to US, which is what every pre-phase-9 row was.
 *
 * Grounding the resolution in the user's own rows is the same principle as the rest of the AI
 * layer: retrieval is deterministic, and it never invents a fact the app does not already hold.
 */
function resolveInstruments(
  symbols: readonly string[],
  known: readonly { symbol: string; market: MarketId }[],
): { symbol: string; market: MarketId }[] {
  const bySymbol = new Map<string, MarketId>()
  for (const entry of known) {
    if (!bySymbol.has(entry.symbol)) bySymbol.set(entry.symbol, entry.market)
  }
  return symbols.map((symbol) => ({ symbol, market: bySymbol.get(symbol) ?? "US" }))
}

/** On-demand indicator computes per request. Each is an OHLCV call, and the free tier allows 8/min. */
const MAX_ON_DEMAND_COMPUTES = 2

async function loadStockFacts(
  supabase: SupabaseClient<Database>,
  instruments: readonly { symbol: string; market: MarketId }[],
  options: { portfolioId?: string; withHistory: boolean },
): Promise<{ stocks: StockFacts[]; marketDataError: string | null }> {
  if (instruments.length === 0) return { stocks: [], marketDataError: null }

  const [stored, watchlist, priced] = await Promise.all([
    readSnapshots(instruments, supabase),
    listWatchlist().catch(() => []),
    getQuotesFor(instruments),
  ])
  const quotes = priced.quotes
  const marketDataError: string | null = priced.error?.message ?? null

  // The caller's own position, from the portfolio engine — never recomputed here.
  const positions = options.portfolioId
    ? (await loadPortfolioView(options.portfolioId)).holdings
    : []

  const watched = new Set(
    watchlist.map((item) => symbolKey(normalizeSymbol(item.symbol), toMarket(item.market))),
  )

  // Anything without a usable cached snapshot is computed now, within a hard budget. A user asking
  // about one stock is worth one OHLCV request; a user asking about five is not worth five.
  const missing = instruments.filter((i) => {
    const entry = stored.get(symbolKey(i.symbol, i.market))
    return !entry || entry.stale
  })
  const computed = new Map<string, { snapshot: TechnicalSnapshot; calculatedAt: string }>()
  const historyBySymbol = new Map<string, HistorySummary | null>()

  for (const { symbol, market } of missing.slice(0, MAX_ON_DEMAND_COMPUTES)) {
    const key = symbolKey(symbol, market)
    try {
      // Indicators come from the instrument's native price series — see docs/MULTI-MARKET.md.
      const candles = await getMarketDataProvider(market).getHistoricalPrices(symbol, "1Y", market)
      if (candles.length >= 50) {
        computed.set(key, {
          snapshot: analyze(symbol, candles),
          calculatedAt: new Date().toISOString(),
        })
      }
      if (options.withHistory) historyBySymbol.set(key, summarizeHistory(candles))
    } catch (error) {
      // A stale snapshot, clearly labelled, beats no answer. The failure is logged, not surfaced
      // as a provider message.
      console.error("[ai] indicator compute failed", symbol, error)
    }
  }

  const stocks: StockFacts[] = instruments.map(({ symbol, market }) => {
    const key = symbolKey(symbol, market)
    const fresh = computed.get(key)
    const cached: StoredSnapshot | undefined = stored.get(key)
    const snapshot = fresh?.snapshot ?? cached?.snapshot ?? null
    const calculatedAt = fresh?.calculatedAt ?? cached?.calculatedAt ?? null
    const delayed = fresh ? false : (cached?.stale ?? true)
    const quote = quotes.get(key)
    const position = positions.find((h) => h.symbol === symbol && h.market === market)

    return {
      symbol,
      market,
      name: quote?.name ?? null,
      // The market's currency, not the provider's: it is what every figure below was computed in.
      currency: currencyOf(market),
      price: quote?.price ?? snapshot?.price ?? null,
      previousClose: quote?.previousClose ?? null,
      changePct: quote?.changePct ?? null,
      quoteAsOf: quote?.asOf ?? null,
      rsi: snapshot?.rsi ?? null,
      adx: snapshot?.adx ?? null,
      macdHistogram: snapshot?.macdHistogram ?? null,
      relativeVolume: snapshot?.relativeVolume ?? null,
      atrPct: snapshot?.atrPct ?? null,
      ema50: snapshot?.ema[50] ?? null,
      ema200: snapshot?.ema[200] ?? null,
      trend: snapshot?.trend ?? "unknown",
      stage: snapshot?.stage ?? "unknown",
      score: snapshot?.score ?? null,
      scoreVersion: snapshot?.scoreVersion ?? "",
      // A cached snapshot stores no prose, so the components are recomputed from the stored
      // readings rather than left empty — the explanation is the point of the score.
      components: snapshot?.components.length
        ? snapshot.components
        : snapshot
          ? rebuildComponents(snapshot)
          : [],
      signals: (snapshot?.signals ?? []).map((code) => SIGNAL_LABELS[code] ?? code),
      candleCount: snapshot?.candleCount ?? 0,
      indicatorsAsOf: calculatedAt,
      indicatorsDelayed: snapshot === null ? true : delayed,
      history: historyBySymbol.get(key) ?? null,
      position: position
        ? {
            quantity: position.quantity,
            averageCost: position.averageCost,
            marketValue: position.marketValue,
            unrealizedPnl: position.unrealizedPnl,
            returnPct: position.returnPct,
            weightPct: position.weight,
          }
        : null,
      watched: watched.has(key),
    }
  })

  return { stocks, marketDataError }
}

/** Re-derives the score breakdown from a stored snapshot, so an explanation is always available. */
function rebuildComponents(snapshot: TechnicalSnapshot): ScoreComponent[] {
  // scoreTechnicals is pure and cheap; calling it beats storing the prose, which would duplicate
  // the scoring rules in the database and let them go stale after a SCORE_VERSION bump.
  return scoreTechnicals(snapshot).components
}

// ---------------------------------------------------------------- assembly

export type BuildContextInput = {
  supabase: SupabaseClient<Database>
  intent: AIIntent
  symbols: string[]
  unknownSymbols: string[]
  portfolioId?: string
  portfolioName?: string
  portfolioCurrency?: string
  savedScreens?: SavedScreenRow[]
}

/** Which sections an intent actually needs. Everything else is not retrieved at all. */
function retrievalPlan(intent: AIIntent) {
  return {
    stocks: intent !== "PORTFOLIO_ANALYSIS" && intent !== "WATCHLIST_ANALYSIS" && intent !== "MARKET_SUMMARY",
    history: intent === "STOCK_ANALYSIS" || intent === "STOCK_COMPARISON",
    portfolio: intent === "PORTFOLIO_ANALYSIS",
    watchlist: intent === "WATCHLIST_ANALYSIS",
    market: intent === "MARKET_SUMMARY",
    screen: intent === "SCREENER_EXPLANATION",
  }
}

export async function buildContext(input: BuildContextInput): Promise<AIContext> {
  const plan = retrievalPlan(input.intent)
  const grounded: GroundedData = {
    stocks: [],
    portfolio: null,
    watchlist: null,
    market: null,
    screen: null,
    unknownSymbols: input.unknownSymbols,
    marketDataError: null,
  }

  // Resolve each symbol to a venue from the user's own holdings and watchlist before retrieving —
  // a bare ticker is ambiguous, and retrieval must be deterministic.
  const known = [
    ...(input.portfolioId ? (await loadPortfolioView(input.portfolioId)).holdings : []),
    ...(await listWatchlist().catch(() => [])).map((item) => ({
      symbol: normalizeSymbol(item.symbol),
      market: toMarket(item.market),
    })),
  ]
  const instruments = resolveInstruments(input.symbols, known)

  if (plan.stocks && instruments.length > 0) {
    const { stocks, marketDataError } = await loadStockFacts(input.supabase, instruments, {
      portfolioId: input.portfolioId,
      withHistory: plan.history,
    })
    grounded.stocks = stocks
    grounded.marketDataError = marketDataError
  }

  if (plan.portfolio && input.portfolioId) {
    grounded.portfolio = await loadPortfolioFacts(
      input.supabase,
      input.portfolioId,
      input.portfolioName ?? "Portfolio",
      input.portfolioCurrency ?? "USD",
    )
  }

  if (plan.watchlist) grounded.watchlist = await loadWatchlistFacts(input.supabase)
  if (plan.market) grounded.market = await loadMarketFacts(input.supabase)
  if (plan.screen && instruments.length > 0) {
    grounded.screen = await explainScreen(input.supabase, instruments[0], input.savedScreens ?? [])
  }

  const sections: string[] = []
  for (const stock of grounded.stocks) sections.push(renderStock(stock))
  if (grounded.portfolio) sections.push(renderPortfolio(grounded.portfolio))
  if (grounded.watchlist) sections.push(renderWatchlist(grounded.watchlist))
  if (grounded.market) sections.push(renderMarket(grounded.market))
  if (grounded.screen) sections.push(renderScreen(grounded.screen))
  if (grounded.unknownSymbols.length > 0) {
    sections.push(
      `### Symbols not found\nThese are not in the supported universe, so no data exists for them: ${grounded.unknownSymbols.join(", ")}. Say they could not be found. Do not describe them.`,
    )
  }
  if (grounded.marketDataError) {
    sections.push(`### Market data\nLive prices could not be loaded for this request. Say so rather than quoting a price.`)
  }
  if (sections.length === 0) {
    sections.push("### No data retrieved\nNothing in Stockly matches this question. Say so plainly.")
  }

  // A hard ceiling, enforced rather than hoped for. Truncation is announced in the block itself so
  // the model does not treat a cut-off list as complete.
  let text = sections.join("\n\n")
  if (text.length > MAX_CONTEXT_CHARS) {
    text = `${text.slice(0, MAX_CONTEXT_CHARS)}\n\n[Context truncated at ${MAX_CONTEXT_CHARS} characters. Do not assume the list above is complete.]`
  }

  const completeness = assessCompleteness(completenessPoints(grounded, plan))
  const timestamps = [
    ...grounded.stocks.map((s) => s.indicatorsAsOf),
    ...grounded.stocks.map((s) => s.quoteAsOf),
    grounded.market?.asOf ?? null,
  ].filter((value): value is string => Boolean(value))

  return {
    intent: input.intent,
    symbols: input.symbols,
    grounded,
    completeness,
    dataAsOf: timestamps.sort().at(-1) ?? new Date().toISOString(),
    delayed: grounded.stocks.some((s) => s.indicatorsDelayed) || (grounded.market?.delayed ?? false),
    text,
  }
}

/**
 * Data completeness — how much of what was expected actually arrived.
 *
 * Reported to the user as coverage, and labelled in the UI as exactly that. It is **not** a
 * confidence that a price will move; nothing in Stockly produces one of those.
 */
function completenessPoints(grounded: GroundedData, plan: ReturnType<typeof retrievalPlan>) {
  const points: { label: string; available: boolean }[] = []

  for (const stock of grounded.stocks) {
    points.push(
      { label: `${stock.symbol} price`, available: stock.price !== null },
      { label: `${stock.symbol} indicators`, available: stock.rsi !== null || stock.adx !== null },
      { label: `${stock.symbol} technical score`, available: stock.score !== null },
      { label: `${stock.symbol} volume`, available: stock.relativeVolume !== null },
    )
    if (plan.history) {
      points.push({ label: `${stock.symbol} price history`, available: stock.history !== null })
    }
  }
  if (plan.portfolio) {
    points.push(
      { label: "Portfolio valuation", available: grounded.portfolio !== null },
      { label: "Sector breakdown", available: (grounded.portfolio?.sectors.length ?? 0) > 0 },
    )
  }
  if (plan.watchlist) {
    points.push({ label: "Watchlist", available: (grounded.watchlist?.count ?? 0) > 0 })
  }
  if (plan.market) points.push({ label: "Market breadth", available: grounded.market !== null })
  if (plan.screen) points.push({ label: "Screen results", available: grounded.screen !== null })

  return points
}

// ---------------------------------------------------------------- section loaders

async function loadPortfolioFacts(
  supabase: SupabaseClient<Database>,
  portfolioId: string,
  name: string,
  currency: string,
): Promise<PortfolioFacts | null> {
  const bundle = await loadAnalytics(portfolioId)
  if (bundle.transactionCount === 0) return null

  const snapshots = await readSnapshots(
    bundle.holdings.map((h) => ({ symbol: h.symbol, market: h.market })),
    supabase,
  )
  // A holding with no FX rate has no knowable weight; it sorts last rather than as 0%.
  const sorted = [...bundle.holdings].sort((a, b) => (b.weight ?? -1) - (a.weight ?? -1))

  return {
    name,
    currency,
    totalValue: bundle.totalValue,
    investedValue: bundle.summary.investedValue,
    cashValue: bundle.cash.balance,
    unrealizedPnl: bundle.summary.unrealizedPnl,
    realizedPnl: bundle.summary.realizedPnl,
    // The same figure the analytics page shows, from the same engine. If the AI and the dashboard
    // disagreed about a return, one of them would be wrong; there is only one source.
    returnPct: bundle.summary.returnPct,
    todayChangePct: bundle.summary.todayReturnPct,
    holdingCount: bundle.holdings.length,
    largest: sorted[0] ? { symbol: sorted[0].symbol, weightPct: sorted[0].weight } : null,
    topWeightsPct: bundle.concentration.top5Weight,
    sectors: bundle.sectors.slice(0, 8).map((s) => ({ label: s.label, weightPct: s.weight })),
    gainers: bundle.movers.gainers.slice(0, 3).map((m) => ({ symbol: m.symbol, returnPct: m.returnPct })),
    losers: bundle.movers.losers.slice(0, 3).map((m) => ({ symbol: m.symbol, returnPct: m.returnPct })),
    technicals: sorted.slice(0, 10).map((h) => ({
      symbol: h.symbol,
      trend: snapshots.get(h.symbol)?.snapshot.trend ?? "unknown",
      score: snapshots.get(h.symbol)?.snapshot.score ?? null,
    })),
  }
}

async function loadWatchlistFacts(
  supabase: SupabaseClient<Database>,
): Promise<WatchlistFacts | null> {
  const items = await listWatchlist().catch(() => [])
  if (items.length === 0) return { count: 0, bullish: 0, neutral: 0, bearish: 0, rows: [] }

  const instruments = items.map((i) => ({
    symbol: normalizeSymbol(i.symbol),
    market: toMarket(i.market),
  }))
  const snapshots = await readSnapshots(instruments, supabase)

  const rows = instruments.map(({ symbol, market }) => {
    const snapshot = snapshots.get(symbolKey(symbol, market))?.snapshot
    return {
      symbol,
      trend: snapshot?.trend ?? "unknown",
      score: snapshot?.score ?? null,
      rsi: snapshot?.rsi ?? null,
      relativeVolume: snapshot?.relativeVolume ?? null,
    }
  })

  return {
    count: rows.length,
    bullish: rows.filter((r) => r.trend === "bullish").length,
    neutral: rows.filter((r) => r.trend === "neutral").length,
    bearish: rows.filter((r) => r.trend === "bearish").length,
    rows,
  }
}

async function loadMarketFacts(supabase: SupabaseClient<Database>): Promise<MarketFacts | null> {
  const stored = await readAllSnapshots(supabase)
  const entries = [...stored.values()]
  if (entries.length === 0) return null

  const scores = entries
    .map((e) => e.snapshot.score)
    .filter((s): s is number => s !== null)
    .sort((a, b) => a - b)

  const timestamps = entries.map((e) => e.calculatedAt).sort()

  return {
    universeSize: entries.length,
    bullish: entries.filter((e) => e.snapshot.trend === "bullish").length,
    neutral: entries.filter((e) => e.snapshot.trend === "neutral").length,
    bearish: entries.filter((e) => e.snapshot.trend === "bearish").length,
    medianScore: scores.length ? scores[Math.floor(scores.length / 2)] : null,
    aboveAverageVolume: entries.filter((e) => (e.snapshot.relativeVolume ?? 0) >= 1).length,
    asOf: timestamps.at(-1) ?? null,
    delayed: entries.some((e) => e.stale),
  }
}

/**
 * Why a stock passes or fails a screen — evaluated by the screener engine, never by the model.
 *
 * The user's own saved screens come first; a preset is used when they have none, so the question
 * always has an answer.
 */
async function explainScreen(
  supabase: SupabaseClient<Database>,
  instrument: { symbol: string; market: MarketId },
  savedScreens: SavedScreenRow[],
): Promise<ScreenExplanation | null> {
  const stored = (await readSnapshots([instrument], supabase)).get(
    symbolKey(instrument.symbol, instrument.market),
  )
  if (!stored) return null

  const saved = savedScreens[0]
  const screenName = saved?.name ?? SCREENER_PRESETS[0].name
  const definition = (saved?.definition as ScreenerDefinition | undefined) ?? SCREENER_PRESETS[0].definition

  const context = { marketCap: null, volume: stored.snapshot.averageVolume }
  const results = definition.filters.map((filter) => {
    const passed = matchesFilter(stored.snapshot, context, filter)
    return {
      condition: `${METRIC_LABELS[filter.metric]} ${OPERATOR_LABELS[filter.operator]} ${filter.value}`,
      passed,
      actual: describeActual(stored.snapshot, filter.metric),
    }
  })

  return {
    screenName,
    symbol: instrument.symbol,
    passedAll: results.every((r) => r.passed),
    results,
  }
}

function describeActual(snapshot: TechnicalSnapshot, metric: ScreenerMetric): string {
  const value = readMetric(snapshot, { marketCap: null, volume: snapshot.averageVolume }, metric)
  if (value === null) return "unavailable"
  return typeof value === "number" ? value.toFixed(2) : String(value)
}
