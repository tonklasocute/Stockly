import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import {
  evaluateAlert,
  messageFor,
  readingFor,
  symbolsToFetch,
  type AlertRule,
  type PortfolioReading,
  type QuoteReading,
} from "@/domain/alerts"
import { buildPortfolio } from "@/domain/holdings"
import { toDomain } from "@/features/transactions/queries"
import { createNotificationService } from "@/services/notifications"
import { getMarketDataProvider, isMarketDataError } from "@/services/market-data"
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
  marketDataError: string | null
  durationMs: number
}

const CATEGORY_FOR_TYPE = (type: AlertRow["type"]): NotificationCategory =>
  type.startsWith("PRICE_") || type.startsWith("PERCENT_")
    ? "price"
    : type === "DIVIDEND_RECEIVED"
      ? "dividend"
      : "portfolio"

function toRule(row: AlertRow): AlertRule {
  return {
    id: row.id,
    type: row.type,
    symbol: row.symbol,
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

  const provider = getMarketDataProvider()

  // ---- one batched quote call for the union of every alert's symbol
  const symbols = symbolsToFetch(alerts)
  let quotes = new Map<string, QuoteReading>()
  let marketOpen: boolean | null = null

  try {
    const [quoteMap, status] = await Promise.all([
      symbols.length > 0 ? provider.getQuotes(symbols) : Promise.resolve(new Map()),
      provider.getMarketStatus(),
    ])
    quotes = new Map(
      [...quoteMap.values()].map((quote) => [
        quote.symbol,
        {
          symbol: quote.symbol,
          price: quote.price,
          previousClose: quote.previousClose,
          asOf: quote.asOf,
        },
      ]),
    )
    marketOpen = status === "unknown" ? null : status === "open"
    summary.symbolsFetched = quotes.size
  } catch (error) {
    // A provider outage means no evaluation this run — never an alert fired from nothing.
    summary.marketDataError = isMarketDataError(error)
      ? error.message
      : "Unable to load market data."
    console.error("[alerts] market data failed", error)
    summary.durationMs = Date.now() - startedAt
    return summary
  }

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

    const extraSymbols = [
      ...new Set((transactions ?? []).map((t) => t.symbol).filter((s) => !quotes.has(s))),
    ]
    if (extraSymbols.length > 0) {
      try {
        const extra = await provider.getQuotes(extraSymbols)
        for (const quote of extra.values()) {
          quotes.set(quote.symbol, {
            symbol: quote.symbol,
            price: quote.price,
            previousClose: quote.previousClose,
            asOf: quote.asOf,
          })
        }
        summary.symbolsFetched = quotes.size
      } catch (error) {
        console.error("[alerts] holdings quotes failed", error)
      }
    }

    for (const portfolioId of portfolioIds) {
      const owned = (transactions ?? [])
        .filter((t) => t.portfolio_id === portfolioId)
        .map((t) => ({ ...t, quantity: Number(t.quantity), price: Number(t.price), fee: Number(t.fee) }))
      if (owned.length === 0) continue

      const { holdings, summary: portfolioSummary } = buildPortfolio(toDomain(owned), (symbol) => {
        const quote = quotes.get(symbol)
        return quote
          ? { price: quote.price, previousClose: quote.previousClose ?? undefined }
          : undefined
      })

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
        weights: Object.fromEntries(holdings.map((h) => [h.symbol, h.weight])),
        asOf,
      })
      summary.portfoliosPriced += 1
    }
  }

  // ---- evaluate, then write
  const notifications = createNotificationService(supabase)
  const triggeredRequests: Array<{ row: AlertRow; rule: AlertRule; triggerValue: number; key: string }> = []

  for (const row of rows ?? []) {
    const rule = toRule(row)
    const portfolio = row.portfolio_id ? (portfolios.get(row.portfolio_id) ?? null) : null
    const reading = readingFor(rule, quotes, portfolio)
    const outcome = evaluateAlert(rule, reading, { now, marketOpen })

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
