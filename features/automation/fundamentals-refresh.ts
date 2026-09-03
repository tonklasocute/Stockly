import "server-only"

import { dedupeEvents } from "@/domain/corporate-events"
import { MARKET_REGISTRY, symbolKey, type MarketId } from "@/domain/market"
import { getFundamentalProvider } from "@/services/fundamentals"
import { describeError, logger } from "@/lib/log"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/types/database"

/**
 * The scheduled fundamentals refresh.
 *
 * Fundamentals change **quarterly**, so this is the slowest-moving job in the application and the
 * one where an aggressive schedule buys nothing. It runs daily, refreshes only instruments somebody
 * actually holds or watches, and is bounded hard — a provider bill is the failure mode here, not a
 * timeout.
 *
 * Four properties, each a line of code below:
 *
 * - **Idempotent.** Statements upsert on `(market, symbol, period_type, fiscal_year,
 *   fiscal_quarter)` and events on their identity index, so a second run in a day rewrites the same
 *   rows rather than appending. Running twice is a no-op.
 * - **Bounded.** `MAX_REFRESH_INSTRUMENTS` per run; a backlog is finished by tomorrow's run.
 * - **Creates nothing a user owns.** It writes only to the two reference tables, neither of which
 *   has a `user_id`. **A dividend event never becomes a dividend received.**
 * - **Observable.** Counters into `job_executions`, never a figure and never a provider payload.
 */

export const MAX_REFRESH_INSTRUMENTS = 40

export type FundamentalsRefresh = {
  instruments: number
  statementsWritten: number
  eventsWritten: number
  failed: number
  skipped: boolean
}

/**
 * The instruments worth refreshing: everything held, plus everything watched.
 *
 * Read across all users through the service-role client — this is reference data, so one fetch of
 * AAPL's statements serves everybody who holds it. That is the whole reason the tables have no
 * `user_id`, and the reason this job is cheap where a per-user one would not be.
 */
async function instrumentsToRefresh(
  supabase: SupabaseClient<Database>,
): Promise<Array<{ symbol: string; market: MarketId }>> {
  const [transactions, watchlist] = await Promise.all([
    supabase.from("transactions").select("symbol, market").limit(2_000),
    supabase.from("watchlist_items").select("symbol, market").limit(1_000),
  ])

  const seen = new Set<string>()
  const out: Array<{ symbol: string; market: MarketId }> = []

  for (const row of [...(transactions.data ?? []), ...(watchlist.data ?? [])]) {
    const market = (row.market ?? "US") as MarketId
    if (!(market in MARKET_REGISTRY)) continue
    const key = symbolKey(row.symbol, market)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ symbol: row.symbol, market })
  }

  return out.slice(0, MAX_REFRESH_INSTRUMENTS)
}

export async function refreshFundamentals(
  supabase: SupabaseClient<Database>,
): Promise<FundamentalsRefresh> {
  const provider = getFundamentalProvider()
  const run: FundamentalsRefresh = {
    instruments: 0,
    statementsWritten: 0,
    eventsWritten: 0,
    failed: 0,
    skipped: false,
  }

  // No provider means nothing to do, and saying so beats writing empty rows that would be
  // indistinguishable from companies that report nothing.
  if (provider.capabilities.markets.length === 0) {
    logger.info("fundamentals.refresh_skipped", { reason: "no_provider" })
    return { ...run, skipped: true }
  }

  const instruments = await instrumentsToRefresh(supabase)
  run.instruments = instruments.length

  for (const instrument of instruments) {
    if (!provider.capabilities.markets.includes(instrument.market)) continue

    try {
      if (provider.capabilities.statements) {
        const statements = await provider.getFinancialStatements({
          ...instrument,
          periodType: "ANNUAL",
          limit: 4,
        })

        for (const statement of statements) {
          const { error } = await supabase.from("financial_statements").upsert(
            {
              symbol: statement.symbol,
              market: statement.market,
              period_type: statement.period.type === "QUARTERLY" ? "QUARTERLY" : "ANNUAL",
              fiscal_year: statement.period.fiscalYear,
              fiscal_quarter: statement.period.fiscalQuarter,
              period_end: statement.period.periodEnd,
              report_date: statement.period.reportDate,
              currency: statement.currency,
              revenue: statement.income.revenue,
              gross_profit: statement.income.grossProfit,
              operating_income: statement.income.operatingIncome,
              ebitda: statement.income.ebitda,
              net_income: statement.income.netIncome,
              eps: statement.income.eps,
              eps_diluted: statement.income.epsDiluted,
              shares_diluted: statement.income.sharesDiluted,
              total_assets: statement.balance.totalAssets,
              total_liabilities: statement.balance.totalLiabilities,
              total_equity: statement.balance.totalEquity,
              cash_and_equivalents: statement.balance.cashAndEquivalents,
              total_debt: statement.balance.totalDebt,
              current_assets: statement.balance.currentAssets,
              current_liabilities: statement.balance.currentLiabilities,
              operating_cash_flow: statement.cashFlow.operatingCashFlow,
              capital_expenditure: statement.cashFlow.capitalExpenditure,
              investing_cash_flow: statement.cashFlow.investingCashFlow,
              financing_cash_flow: statement.cashFlow.financingCashFlow,
              dividends_paid: statement.cashFlow.dividendsPaid,
              source: statement.source,
              fetched_at: statement.fetchedAt,
            },
            { onConflict: "market,symbol,period_type,fiscal_year,fiscal_quarter" },
          )
          if (error) {
            logger.warn("fundamentals.statement_write_failed", { code: error.code })
            run.failed += 1
          } else {
            run.statementsWritten += 1
          }
        }
      }

      if (provider.capabilities.corporateEvents) {
        const events = dedupeEvents(await provider.getCorporateEvents(instrument.symbol, instrument.market))
        for (const event of events) {
          const { error } = await supabase.from("corporate_events").upsert(
            {
              symbol: event.symbol,
              market: event.market,
              event_type: event.type,
              event_date: event.date,
              estimated: event.estimated,
              title: event.title,
              detail: event.detail,
              amount_per_share: event.amountPerShare,
              currency: event.currency,
              ratio: event.ratio,
              source: event.source,
              fetched_at: event.fetchedAt,
            },
            // The identity index, not the exact date: a re-dated event updates in place.
            { onConflict: "market,symbol,event_type" },
          )
          if (error) {
            logger.warn("fundamentals.event_write_failed", { code: error.code })
            run.failed += 1
          } else {
            run.eventsWritten += 1
          }
        }
      }
    } catch (error) {
      // One instrument's failure costs that instrument, never the run.
      logger.warn("fundamentals.refresh_failed", {
        symbol: instrument.symbol,
        market: instrument.market,
        ...describeError(error),
      })
      run.failed += 1
    }
  }

  logger.info("fundamentals.refresh_completed", {
    instruments: run.instruments,
    statements: run.statementsWritten,
    events: run.eventsWritten,
    failed: run.failed,
  })
  return run
}
