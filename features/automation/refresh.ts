import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { MARKETS, currencyOf, toMarket, type Currency, type MarketId } from "@/domain/market"
import { marketSessionStatus } from "@/domain/calendar"
import { loadAllFxRates } from "@/services/fx"
import { getQuotesFor, isMarketDataError } from "@/services/market-data"
import { logger } from "@/lib/log"
import type { Database, JobExecutionRow } from "@/types/database"

/**
 * Scheduled data refresh.
 *
 * This orchestrates the **existing** providers rather than introducing a second way to fetch: quotes
 * go through `services/market-data` and rates through `services/fx`, so everything phase 9 settled
 * about batching, routing, caching and failure still holds. What is added is *when*.
 *
 * The point of warming a cache on a schedule is that a user's first page load of the day is not the
 * request that pays for it. Both caches are the Next Data Cache, which is shared across serverless
 * instances — so one scheduled fetch serves every visitor until it expires.
 *
 * Bounded by construction: one batched call per market, one per currency pair, and a symbol ceiling.
 * Nothing here is long-running, and nothing writes a transaction.
 */

/** The most instruments one run will price. A ceiling on what a single execution can cost. */
export const MAX_REFRESH_SYMBOLS = 120

export type RefreshSummary = {
  markets: Array<{ market: MarketId; status: string; refreshed: number; skipped: boolean }>
  symbols: number
  quotesFetched: number
  fxPairs: number
  fxMissing: string[]
  errors: string[]
}

/**
 * Which markets are worth calling right now.
 *
 * A closed exchange publishes no new prices, so refreshing it spends a credit to receive the number
 * already cached. `"unknown"` — past the calendar's verified horizon — is refreshed anyway: being
 * wrong there costs one request, whereas skipping a market that is actually trading costs a stale
 * portfolio, and the request is the cheaper mistake.
 */
export function marketsWorthRefreshing(now: Date): Array<{ market: MarketId; status: string }> {
  return MARKETS.map((market) => ({ market, status: marketSessionStatus(market, now) })).filter(
    ({ status }) => status !== "closed",
  )
}

/** Every instrument this deployment's users hold, watch or have an enabled alert on. */
async function refreshableInstruments(
  supabase: SupabaseClient<Database>,
): Promise<Array<{ symbol: string; market: MarketId }>> {
  // Three single-column scans on indexed tables rather than one join, and independent.
  const [transactions, watchlist, alerts] = await Promise.all([
    supabase.from("transactions").select("symbol, market"),
    supabase.from("watchlist_items").select("symbol, market"),
    supabase.from("alerts").select("symbol, market").eq("enabled", true),
  ])

  const seen = new Map<string, { symbol: string; market: MarketId }>()
  for (const rows of [transactions.data, watchlist.data, alerts.data]) {
    for (const row of rows ?? []) {
      if (!row.symbol) continue
      const market = toMarket(row.market)
      seen.set(`${market}:${row.symbol}`, { symbol: row.symbol, market })
    }
  }
  return [...seen.values()].slice(0, MAX_REFRESH_SYMBOLS)
}

/**
 * Warms the quote and rate caches.
 *
 * **Creates nothing and changes nothing a user owns.** A refresh writes to a provider cache; it
 * cannot produce a transaction, and a provider that fails leaves the previous cached value in place
 * to be served as stale rather than replacing it with a zero.
 */
export async function refreshMarketData(
  supabase: SupabaseClient<Database>,
  { now = new Date() }: { now?: Date } = {},
): Promise<RefreshSummary> {
  const summary: RefreshSummary = {
    markets: [],
    symbols: 0,
    quotesFetched: 0,
    fxPairs: 0,
    fxMissing: [],
    errors: [],
  }

  const open = marketsWorthRefreshing(now)
  const openIds = new Set(open.map((entry) => entry.market))
  const instruments = await refreshableInstruments(supabase)
  summary.symbols = instruments.length

  for (const market of MARKETS) {
    const status = open.find((entry) => entry.market === market)?.status ?? "closed"
    const forMarket = instruments.filter((instrument) => instrument.market === market)

    if (!openIds.has(market) || forMarket.length === 0) {
      summary.markets.push({ market, status, refreshed: 0, skipped: true })
      continue
    }

    // One batched call for the whole market — never one per symbol.
    const priced = await getQuotesFor(forMarket)
    summary.quotesFetched += priced.quotes.size
    summary.markets.push({
      market,
      status,
      refreshed: priced.quotes.size,
      skipped: false,
    })
    if (priced.error) {
      // A market failing costs that market's prices, not the run.
      summary.errors.push(
        `${market}: ${isMarketDataError(priced.error) ? priced.error.code : "UNAVAILABLE"}`,
      )
    }
  }

  // Rates against every base currency a portfolio in this deployment actually uses, so the pairs
  // warmed are the pairs someone will ask for.
  const bases = await activeBaseCurrencies(supabase)
  for (const base of bases) {
    try {
      const table = await loadAllFxRates(base)
      summary.fxPairs += table.rates.size
      summary.fxMissing.push(...table.missing)
    } catch (error) {
      summary.errors.push(`fx ${base}: ${error instanceof Error ? error.name : "UNKNOWN"}`)
    }
  }

  // Counters only: no user ids, no symbols, no amounts.
  logger.info("refresh.completed", {
    symbols: summary.symbols,
    quotes: summary.quotesFetched,
    fxPairs: summary.fxPairs,
    errors: summary.errors.length,
  })

  return summary
}

/** The base currencies in use, so no rate is fetched for a currency nobody keeps a portfolio in. */
async function activeBaseCurrencies(supabase: SupabaseClient<Database>): Promise<Currency[]> {
  const { data } = await supabase.from("portfolios").select("currency")
  const seen = new Set<Currency>()
  for (const row of data ?? []) {
    const currency = row.currency as Currency
    if (currency) seen.add(currency)
  }
  // A deployment with no portfolios still warms the pair every market implies.
  if (seen.size === 0) for (const market of MARKETS) seen.add(currencyOf(market))
  return [...seen]
}

// ---------------------------------------------------------------- job history

export type JobResult = { processed: number; succeeded: number; failed: number }

/**
 * Runs a job and records that it ran.
 *
 * The record is counters and a short reason — never a provider payload, never a stack trace, and
 * nothing identifying. It exists so the data-quality page can say when prices were last refreshed
 * and whether it worked, which is a question a user asks and stdout cannot answer.
 *
 * A failure is recorded and rethrown: the caller decides the response, and the history keeps the
 * row either way.
 */
export async function recordJob<T extends JobResult>(
  supabase: SupabaseClient<Database>,
  job: string,
  run: () => Promise<T>,
): Promise<T> {
  const { data: started } = await supabase
    .from("job_executions")
    .insert({ job, status: "RUNNING", processed: 0, succeeded: 0, failed: 0 })
    .select("id")
    .maybeSingle()

  const finish = async (patch: Partial<Omit<JobExecutionRow, "id" | "job">>) => {
    if (!started?.id) return
    // A lost history row must not fail a job that already did its work.
    await supabase
      .from("job_executions")
      .update({ completed_at: new Date().toISOString(), ...patch })
      .eq("id", started.id)
      .then(({ error }) => {
        if (error) logger.warn("job.history_write_failed", { job, code: error.code })
      })
  }

  try {
    const result = await run()
    await finish({
      status: result.failed > 0 ? "PARTIAL" : "OK",
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
    })
    return result
  } catch (error) {
    await finish({
      status: "FAILED",
      error_summary: (error instanceof Error ? error.message : "Unknown failure").slice(0, 500),
    })
    throw error
  }
}

/** The most recent execution of a job, for the data-quality page. */
export async function lastRun(
  supabase: SupabaseClient<Database>,
  job: string,
): Promise<JobExecutionRow | null> {
  const { data } = await supabase
    .from("job_executions")
    .select("*")
    .eq("job", job)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ?? null
}
