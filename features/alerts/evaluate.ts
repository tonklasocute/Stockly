import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  evaluateAlert,
  messageFor,
  readingFor,
  instrumentsToFetch,
  TECHNICAL_ALERT_TYPES,
  type AlertRule,
  type PortfolioReading,
  type QuoteReading,
  type TechnicalReading,
} from "@/domain/alerts"
import { readSnapshots, toTechnicalReading } from "@/features/technical/snapshots"
import { buildPortfolio } from "@/domain/holdings"
import { symbolKey, toMarket } from "@/domain/market"
import { dedupeInstruments } from "@/features/portfolios/portfolio-view"
import { toDomain } from "@/features/transactions/queries"
import { createNotificationService } from "@/services/notifications"
import { getMarketStatuses, getQuotesFor, type MarketStatus, type Quote } from "@/services/market-data"
import { loadFxTable } from "@/services/fx"
import { converterTo } from "@/domain/fx"
import { baseCurrencyOf, currencyOf, MARKETS, type MarketId } from "@/domain/market"
import type { AlertRow, Database, NotificationCategory } from "@/types/database"

/**
 * The scheduled evaluation.
 *
 * Shape, and why: **one pass over every enabled alert, one batched quote call for the union of their
 * symbols.** A thousand alerts on NVDA across a hundred users is one upstream request. The naive
 * loop — for each user, for each alert, fetch — is what turns 100 users into 10,000 calls and
 * exhausts the provider's minute budget on the first ten.
 *
 * Portfolio-derived alerts need holdings, so the portfolios they reference are loaded once each and
 * priced from the quotes already in hand.
 *
 * Everything decision-shaped lives in `domain/alerts.ts`. This function is I/O: load, call, write.
 */

export type EvaluationSummary = {
  alertsConsidered: number
  alertsEvaluated: number
  triggered: number
  skippedStale: number
  skippedMarketClosed: number
  skippedNoReading: number
  notificationsCreated: number
  pushSent: number
  pushFailed: number
  pushExpired: number
  symbolsFetched: number
  portfoliosPriced: number
  technicalSnapshotsRead: number
  marketDataError: string | null
  durationMs: number
}

const CATEGORY_FOR_TYPE = (type: AlertRow["type"]): NotificationCategory => {
  if (type === "DIVIDEND_RECEIVED") return "dividend"
  if (type.startsWith("PORTFOLIO_") || type.startsWith("POSITION_")) return "portfolio"
  // Technical conditions are about one stock's chart, so they belong with the price notifications.
  return "price"
}

function toRule(row: AlertRow): AlertRule {
  return {
    id: row.id,
    type: row.type,
    symbol: row.symbol,
    market: toMarket(row.market),
    targetValue: Number(row.target_value),
    enabled: row.enabled,
    state: row.state,
    lastValue: row.last_value === null ? null : Number(row.last_value),
    lastTriggeredAt: row.last_triggered_at,
    cooldownMinutes: row.cooldown_minutes,
  }
}

export async function evaluateAllAlerts(
  supabase: SupabaseClient<Database>,
  now: Date = new Date(),
): Promise<EvaluationSummary> {
  const startedAt = Date.now()
  const summary: EvaluationSummary = {
    alertsConsidered: 0,
    alertsEvaluated: 0,
    triggered: 0,
    skippedStale: 0,
    skippedMarketClosed: 0,
    skippedNoReading: 0,
    notificationsCreated: 0,
    pushSent: 0,
    pushFailed: 0,
    pushExpired: 0,
    symbolsFetched: 0,
    portfoliosPriced: 0,
    technicalSnapshotsRead: 0,
    marketDataError: null,
    durationMs: 0,
  }

  // Only enabled, schedule-driven rules. DIVIDEND_RECEIVED is raised by the write that causes it.
  const { data: rows, error } = await supabase
    .from("alerts")
    .select("*")
    .eq("enabled", true)
    .neq("type", "DIVIDEND_RECEIVED")

  if (error) throw error
  const alerts = (rows ?? []).map(toRule)
  summary.alertsConsidered = alerts.length
  if (alerts.length === 0) {
    summary.durationMs = Date.now() - startedAt
    return summary
  }

  // ---- one batched quote call per market, for the union of every alert's instrument
  //
  // Quotes are keyed by `symbolKey`, and so is every lookup against them: a price alert on a SET
  // listing must never be answered by a US quote that happens to share three letters.
  const instruments = instrumentsToFetch(alerts)
  const quotes = new Map<string, QuoteReading>()
  let statuses: Record<MarketId, MarketStatus> = Object.fromEntries(
    MARKETS.map((m) => [m, "unknown" as MarketStatus]),
  ) as Record<MarketId, MarketStatus>

  const addQuotes = (found: Map<string, Quote>) => {
    for (const [key, quote] of found) {
      quotes.set(key, {
        symbol: quote.symbol,
        price: quote.price,
        previousClose: quote.previousClose,
        asOf: quote.asOf,
      })
    }
  }

  {
    const [priced, marketStatuses] = await Promise.all([
      instruments.length > 0
        ? getQuotesFor(instruments)
        : Promise.resolve({ quotes: new Map<string, Quote>(), failed: [], error: null }),
      getMarketStatuses(),
    ])
    // A provider outage means no evaluation for that market — never an alert fired from nothing —
    // but one market being down must not stop the others being evaluated.
    if (priced.error && priced.quotes.size === 0 && instruments.length > 0) {
      summary.marketDataError = priced.error.message
      console.error("[alerts] market data failed", priced.error.code)
      summary.durationMs = Date.now() - startedAt
      return summary
    }
    if (priced.error) summary.marketDataError = priced.error.message
    addQuotes(priced.quotes)
    statuses = marketStatuses
    summary.symbolsFetched = quotes.size
  }

  const marketOpenFor = (market: MarketId): boolean | null =>
    statuses[market] === "unknown" ? null : statuses[market] === "open"

  // ---- portfolios, loaded once each, priced from the quotes already fetched
  const portfolioIds = [
    ...new Set(
      (rows ?? [])
        .filter((row) => row.portfolio_id && !row.type.startsWith("PRICE_") && !row.type.startsWith("PERCENT_"))
        .map((row) => row.portfolio_id as string),
    ),
  ]
  const portfolios = new Map<string, PortfolioReading>()

  if (portfolioIds.length > 0) {
    const { data: transactions } = await supabase
      .from("transactions")
      .select("*")
      .in("portfolio_id", portfolioIds)

    const extra = dedupeInstruments(transactions ?? []).filter(
      (i) => !quotes.has(symbolKey(i.symbol, i.market)),
    )
    if (extra.length > 0) {
      const priced = await getQuotesFor(extra)
      addQuotes(priced.quotes)
      summary.symbolsFetched = quotes.size
    }

    // Each portfolio is valued in its own base currency, so a "total return" alert on a baht
    // portfolio compares baht against baht. Rates are fetched once for the union of currencies.
    const { data: portfolioRows } = await supabase
      .from("portfolios")
      .select("id, currency")
      .in("id", portfolioIds)
    const baseCurrencies = new Map(
      (portfolioRows ?? []).map((row) => [row.id, baseCurrencyOf(row.currency)]),
    )
    const fxTables = new Map(
      await Promise.all(
        [...new Set(baseCurrencies.values())].map(
          async (base) =>
            [
              base,
              await loadFxTable(base, MARKETS.map((m) => currencyOf(m))),
            ] as const,
        ),
      ),
    )

    for (const portfolioId of portfolioIds) {
      const owned = (transactions ?? [])
        .filter((t) => t.portfolio_id === portfolioId)
        .map((t) => ({ ...t, quantity: Number(t.quantity), price: Number(t.price), fee: Number(t.fee) }))
      if (owned.length === 0) continue

      const baseCurrency = baseCurrencies.get(portfolioId) ?? "USD"
      const fx = fxTables.get(baseCurrency)

      const { holdings, summary: portfolioSummary } = buildPortfolio(
        toDomain(owned),
        (symbol, market) => {
          const quote = quotes.get(symbolKey(symbol, market))
          return quote
            ? { price: quote.price, previousClose: quote.previousClose ?? undefined }
            : undefined
        },
        {
          baseCurrency,
          convert: fx ? converterTo(baseCurrency, fx, now) : undefined,
        },
      )

      // The freshest quote in the portfolio decides how old this reading is.
      const asOf = holdings.length
        ? [...quotes.values()]
            .filter((q) => holdings.some((h) => h.symbol === q.symbol))
            .map((q) => q.asOf)
            .sort()
            .at(-1) ?? new Date(0).toISOString()
        : new Date(0).toISOString()

      portfolios.set(portfolioId, {
        dailyChangePct: portfolioSummary.todayReturnPct,
        totalReturnPct: portfolioSummary.returnPct,
        // Keyed per instrument, and only for holdings that could be expressed in the portfolio's
        // base currency: a weight nobody can compute is absent, never 0, so a "weight below"
        // alert cannot fire on a position whose share is simply unknown.
        weights: Object.fromEntries(
          holdings
            .filter((h) => h.weight !== null)
            .map((h) => [symbolKey(h.symbol, h.market), h.weight as number]),
        ),
        asOf,
      })
      summary.portfoliosPriced += 1
    }
  }

  // ---- technical readings, from the cached snapshots the refresh job computed
  //
  // Read, never computed here: an OHLCV history per symbol is one request each with no batching,
  // which would blow the provider's minute budget on the first handful of alerts.
  const technicalInstruments = [
    ...new Map(
      (rows ?? [])
        .filter((row) => row.symbol && TECHNICAL_ALERT_TYPES.includes(row.type))
        .map((row) => {
          const market = toMarket(row.market)
          return [symbolKey(row.symbol as string, market), { symbol: row.symbol as string, market }]
        }),
    ).values(),
  ]
  const technicals = new Map<string, TechnicalReading>()
  if (technicalInstruments.length > 0) {
    const stored = await readSnapshots(technicalInstruments, supabase)
    // Already keyed by `symbolKey`, which is exactly what `readingFor` looks up.
    for (const [key, entry] of stored) technicals.set(key, toTechnicalReading(entry))
    summary.technicalSnapshotsRead = stored.size
  }

  // ---- evaluate, then write
  const notifications = createNotificationService(supabase)
  const triggeredRequests: Array<{ row: AlertRow; rule: AlertRule; triggerValue: number; key: string }> = []

  for (const row of rows ?? []) {
    const rule = toRule(row)
    const portfolio = row.portfolio_id ? (portfolios.get(row.portfolio_id) ?? null) : null
    const reading = readingFor(rule, quotes, portfolio, technicals)
    // The session guard is per market: New York being shut says nothing about Bangkok.
    const outcome = evaluateAlert(rule, reading, { now, marketOpen: marketOpenFor(rule.market) })

    if (outcome.action === "skip") {
      if (outcome.reason === "stale-reading") summary.skippedStale += 1
      else if (outcome.reason === "market-closed") summary.skippedMarketClosed += 1
      else if (outcome.reason === "no-reading") summary.skippedNoReading += 1
      continue
    }

    summary.alertsEvaluated += 1

    const update: Database["public"]["Tables"]["alerts"]["Update"] = {
      state: outcome.nextState,
      last_value: outcome.nextValue,
      last_evaluated_at: now.toISOString(),
      ...(outcome.action === "trigger" ? { last_triggered_at: now.toISOString() } : {}),
    }
    if (outcome.action === "trigger") {
      triggeredRequests.push({
        row,
        rule,
        triggerValue: outcome.triggerValue,
        key: outcome.idempotencyKey,
      })
    }
    await supabase.from("alerts").update(update).eq("id", row.id)
  }

  for (const { row, rule, triggerValue, key } of triggeredRequests) {
    const message = messageFor(rule, triggerValue)

    // The unique index on idempotency_key is what makes a duplicate cron run a no-op: the second
    // insert conflicts, we see zero rows back, and no notification is created.
    const { data: event, error: eventError } = await supabase
      .from("alert_events")
      .insert({
        alert_id: row.id,
        user_id: row.user_id,
        triggered_at: now.toISOString(),
        trigger_value: triggerValue,
        reference_value: rule.targetValue,
        message: `${message.title} ${message.body}`,
        idempotency_key: key,
      })
      .select("id")
      .maybeSingle()

    if (eventError?.code === "23505") continue // already recorded by a concurrent run
    if (eventError || !event) {
      console.error("[alerts] event insert failed", { alertId: row.id, code: eventError?.code })
      continue
    }

    summary.triggered += 1
    const delivery = await notifications.deliver({
      userId: row.user_id,
      category: CATEGORY_FOR_TYPE(row.type),
      title: message.title,
      body: message.body,
      href: message.href,
      alertId: row.id,
    })

    if (delivery.inApp) summary.notificationsCreated += 1
    summary.pushSent += delivery.pushSent
    summary.pushFailed += delivery.pushFailed
    summary.pushExpired += delivery.pushExpired
  }

  summary.durationMs = Date.now() - startedAt
  return summary
}
