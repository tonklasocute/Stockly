import { ApiError, enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { invalidateAlerts } from "@/lib/cache"
import { evaluateAlert, readingFor, SYMBOL_ALERT_TYPES, type AlertRule } from "@/domain/alerts"
import { alertInputSchema } from "@/features/alerts/schema"
import { listAlerts } from "@/features/alerts/queries"
import { MAX_ALERTS_PER_USER } from "@/lib/rate-limit"
import { createClient } from "@/lib/supabase/server"
import { getMarketDataProvider } from "@/services/market-data"

export async function GET() {
  return guarded(async () => ok({ alerts: await listAlerts() }))
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    enforceRateLimit(`alerts:create:${userId}`, 20, 60)
    const body = await parseBody(request, alertInputSchema)
    const supabase = await createClient()

    // A hard cap the database can answer, unlike an in-memory counter a cold start forgets.
    const { count } = await supabase.from("alerts").select("id", { count: "exact", head: true })
    if ((count ?? 0) >= MAX_ALERTS_PER_USER) {
      throw new ApiError(
        "CONFLICT",
        `You can have at most ${MAX_ALERTS_PER_USER} alerts. Delete one to add another.`,
      )
    }

    const symbol = SYMBOL_ALERT_TYPES.includes(body.type) ? (body.symbol ?? null) : null

    /**
     * Seed the state from the market as it is right now, without notifying.
     *
     * An alert created while its condition is already true (NVDA is $250, target $200) is stored as
     * `triggered`, so it fires on the next genuine crossing rather than the moment it is saved.
     * Announcing something the user just looked at is noise, not an alert.
     */
    let state: AlertRule["state"] = "armed"
    let lastValue: number | null = null

    if (symbol) {
      try {
        const quotes = await getMarketDataProvider().getQuotes([symbol])
        const quote = quotes.get(symbol)
        if (quote) {
          const rule: AlertRule = {
            id: "new",
            type: body.type,
            symbol,
            targetValue: body.targetValue,
            enabled: true,
            state: "armed",
            lastValue: null,
            lastTriggeredAt: null,
            cooldownMinutes: body.cooldownMinutes,
          }
          const reading = readingFor(
            rule,
            new Map([
              [symbol, { symbol, price: quote.price, previousClose: quote.previousClose, asOf: quote.asOf }],
            ]),
            null,
          )
          const outcome = evaluateAlert(rule, reading, { now: new Date(), marketOpen: null })
          if (outcome.action === "trigger" || outcome.action === "hold") {
            state = "triggered"
            lastValue = outcome.nextValue ?? null
          } else if (outcome.action === "arm") {
            lastValue = outcome.nextValue
          }
        }
      } catch {
        // Market data is unavailable: leave the alert armed. The first evaluation will settle it.
      }
    }

    const { data, error } = await supabase
      .from("alerts")
      .insert({
        user_id: userId, // from the session, never the body
        portfolio_id: body.portfolioId ?? null,
        symbol,
        market: "US",
        type: body.type,
        target_value: body.targetValue,
        enabled: body.enabled,
        state,
        last_value: lastValue,
        last_evaluated_at: null,
        last_triggered_at: null,
        cooldown_minutes: body.cooldownMinutes,
        notes: body.notes ?? null,
      })
      .select("*")
      .single()

    if (error?.code === "23505") {
      throw new ApiError("CONFLICT", "You already have this exact alert.")
    }
    if (error?.code === "23514") {
      throw new ApiError("VALIDATION_ERROR", "That alert violates a data rule.")
    }
    if (error) throw error

    invalidateAlerts()
    return ok(data, 201)
  })
}
