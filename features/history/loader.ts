import "server-only"

import { cache } from "react"
import { attribute, activeReturn, rankContributors, residual, type HoldingPeriod } from "@/domain/attribution"
import { drawdownHistory, regimeOf, type DrawdownHistory } from "@/domain/drawdown-history"
import {
  capitalFlowsBetween,
  computeFeeImpact,
  computeTurnover,
  monthsBetween,
  netFlow,
  periodStart,
  qualityOf,
  reconstructAt,
  type CapitalFlow,
  type HistoryPeriod,
  type ValuedPoint,
} from "@/domain/history"
import { dividendAmounts } from "@/domain/dividends"
import { returnIndex, simpleReturn, timeWeightedReturn } from "@/domain/returns"
import { symbolKey, type Currency } from "@/domain/market"
import { loadIntelligence } from "@/features/intelligence/loader"
import { listCashTransactions, toDomainCash } from "@/features/cash/queries"
import { listDividends, toDomainDividends } from "@/features/dividends/queries"
import { listTransactions, toDomain } from "@/features/transactions/queries"
import { createClient } from "@/lib/supabase/server"
import type { PortfolioSnapshotRow } from "@/types/database"

/**
 * Everything the history and attribution screens need, in one pass.
 *
 * The shape of the problem, and why this loader exists rather than six of them: history, drawdowns,
 * monthly performance, allocation drift and attribution all read the **same two things** — the
 * transaction set and the snapshot series. Six loaders would be six reads of both. This is one, and
 * `cache()` deduplicates it within a render so a page and every section on it share it.
 *
 * It adds **no upstream call**. `loadIntelligence` has already made the single batched quote call
 * for the current valuation; everything historical comes from rows already in the database. That is
 * deliberate and it is the reason opening the history page cannot cost a provider credit per
 * holding — see `docs/PERFORMANCE.md`.
 */

export type MonthlyRow = {
  month: string
  /** Portfolio return over the month, capital flows removed. Null when it cannot be computed. */
  returnPct: number | null
  benchmarkReturnPct: number | null
  activeReturnPct: number | null
  dividends: number
  netFlow: number
  endingValue: number | null
  quality: ValuedPoint["quality"]
}

export type HistoryBundle = {
  period: HistoryPeriod
  baseCurrency: Currency
  /** The valued series for the period, one point per recorded snapshot. */
  points: ValuedPoint[]
  /** Flow-adjusted index, rebased to 100. What drawdown and return read. */
  index: { date: string; index: number }[]
  timeWeightedReturnPct: number | null
  moneyWeightedReturnPct: number | null
  /** Change in portfolio value, which is **not** a return: it includes money paid in. */
  valueChange: number | null
  flows: CapitalFlow[]
  netFlow: number
  attribution: ReturnType<typeof attribute>
  contributors: ReturnType<typeof rankContributors>
  /** How far the attributed parts miss the whole. Evidence, not something to hide. */
  attributionResidual: number | null
  drawdowns: DrawdownHistory | null
  regime: ReturnType<typeof regimeOf>
  monthly: MonthlyRow[]
  active: ReturnType<typeof activeReturn>
  turnover: ReturnType<typeof computeTurnover>
  fees: ReturnType<typeof computeFeeImpact>
  /** How much of the period Stockly actually has readings for. */
  coverage: { days: number; snapshots: number; completeSnapshots: number }
}

/** Snapshots for a portfolio in the base currency it is currently kept in. */
async function loadSnapshots(portfolioId: string, currency: Currency): Promise<PortfolioSnapshotRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("portfolio_snapshots")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("snapshot_date", { ascending: true })

  if (error) throw error
  /*
   * Only the rows taken in the currency the page is being shown in.
   *
   * A snapshot is the one figure Stockly cannot recompute, so a row written when the portfolio was
   * kept in dollars stays a dollar figure forever. Plotting it beside a baht row would put a
   * thirty-two-fold cliff in the chart and label it performance.
   */
  return (data ?? []).filter((row) => row.currency === currency)
}

export const loadHistory = cache(
  async (portfolioId: string, period: HistoryPeriod = "1Y"): Promise<HistoryBundle> => {
    const now = new Date()
    const start = periodStart(period, now)
    const today = now.toISOString().slice(0, 10)

    const [intelligence, transactionRows, cashRows, dividendRows] = await Promise.all([
      loadIntelligence(portfolioId),
      listTransactions(portfolioId),
      listCashTransactions(portfolioId),
      listDividends(portfolioId),
    ])

    const baseCurrency = intelligence.baseCurrency
    const snapshots = await loadSnapshots(portfolioId, baseCurrency)
    const transactions = toDomain(transactionRows)
    const cash = toDomainCash(cashRows)
    const dividends = toDomainDividends(dividendRows)

    // `dividendAmounts` is the existing net-of-tax-and-fee calculation. Restating it here would be
    // a second answer to what a dividend was worth.
    const dividendFlows = dividends.map((d) => ({
      date: d.paidOn.slice(0, 10),
      amount: dividendAmounts(d).net,
      symbol: d.symbol,
    }))
    const from = start ?? snapshots[0]?.snapshot_date ?? today

    const inPeriod = snapshots.filter((row) => row.snapshot_date >= from)

    const points: ValuedPoint[] = inPeriod.map((row) => {
      const { quality, reason } = qualityOf({
        hasValue: true,
        missingHoldings: row.missing_holdings,
        stale: row.quality === "STALE",
      })
      return {
        date: row.snapshot_date,
        totalValue: row.total_value,
        investedCapital: row.invested_value,
        cashBalance: row.cash_value,
        // Reconstructed rather than stored: external money added by this date is exact from the
        // transaction set, so there is no reason to trust a column for it.
        netContributed: reconstructAt(
          { transactions, cashTransactions: cash, dividends: dividendFlows, baseCurrency },
          row.snapshot_date,
        ).netContributed,
        realizedPnl: row.realized_pnl,
        unrealizedPnl: row.unrealized_pnl,
        quality,
        reason,
      }
    })

    // The flow-adjusted valuation points the return and risk engines already read.
    const valuations = intelligence.valuations.filter((v) => v.date >= from)
    const index = (returnIndex(valuations) ?? []).map((p) => ({ date: p.date, index: p.index * 100 }))

    const flows = capitalFlowsBetween(cash, from, today)
    const flowTotal = netFlow(flows)

    const first = points[0] ?? null
    const last = points[points.length - 1] ?? null

    const attribution = attribute({
      beginningValue: first?.totalValue ?? null,
      endingValue: last?.totalValue ?? null,
      netFlow: flowTotal,
      holdings: buildHoldingPeriods(intelligence, transactions, dividends, from, today, baseCurrency),
    })

    const drawdowns = drawdownHistory(index)
    const recentChangePct =
      index.length >= 2 ? simpleReturn(index[index.length - 2].index, index[index.length - 1].index) : null

    const averageValue =
      points.length > 0
        ? points.reduce((total, p) => total + (p.totalValue ?? 0), 0) /
          points.filter((p) => p.totalValue !== null).length
        : null

    return {
      period,
      baseCurrency,
      points,
      index,
      timeWeightedReturnPct: timeWeightedReturn(valuations),
      moneyWeightedReturnPct: intelligence.moneyWeightedReturnPct,
      /*
       * The change in what the portfolio is worth — **not** a return.
       *
       * Reported beside the returns and never labelled as one: a portfolio that grew by a deposit
       * has a value change and no performance, and conflating the two is the most common way a
       * tracker flatters its user.
       */
      valueChange:
        first?.totalValue !== null && last?.totalValue != null && first
          ? last.totalValue - first.totalValue
          : null,
      flows,
      netFlow: flowTotal,
      attribution,
      contributors: attribution.ok
        ? rankContributors(attribution.contributions)
        : { contributors: [], detractors: [] },
      attributionResidual: attribution.ok ? residual(attribution) : null,
      drawdowns,
      regime: regimeOf(drawdowns, recentChangePct),
      monthly: buildMonthly(points, dividendFlows, cash, from, today),
      active: activeReturn({
        portfolioReturnPct: timeWeightedReturn(valuations),
        benchmarkReturnPct: intelligence.benchmark?.benchmarkReturnPct ?? null,
        portfolioCurrency: baseCurrency,
        benchmarkCurrency:
          (intelligence.benchmark?.currencyMismatch?.benchmark as Currency | undefined) ?? baseCurrency,
      }),
      turnover: computeTurnover(transactions, from, today, Number.isFinite(averageValue) ? averageValue : null),
      fees: computeFeeImpact(transactions, intelligence.analytics.summary.investedValue),
      coverage: {
        days: Math.max(
          0,
          Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000),
        ),
        snapshots: points.length,
        completeSnapshots: points.filter((p) => p.quality === "COMPLETE").length,
      },
    }
  },
)

/**
 * One `HoldingPeriod` per instrument the portfolio touched during the window.
 *
 * The honest limitation, stated where it happens: **Stockly does not store a per-holding price
 * history**, so a position's value at the *start* of the period is only known when it is also the
 * present — and it is not. `beginValue` is therefore `null` for every holding, which makes the
 * attribution measure the money each position made **from what was put into it during the period**
 * rather than from a beginning market value.
 *
 * That is a real methodology with a real meaning, and `docs/performance-attribution.md` §6 states
 * it: for a period the portfolio was held through unchanged, it under-reports, and the residual
 * reported beside it is exactly the size of what was missed. It is not a guess dressed as an
 * analytic — it is a narrower question, answered correctly, with the gap measured.
 */
function buildHoldingPeriods(
  intelligence: Awaited<ReturnType<typeof loadIntelligence>>,
  transactions: ReturnType<typeof toDomain>,
  dividends: ReturnType<typeof toDomainDividends>,
  from: string,
  to: string,
  baseCurrency: Currency,
): HoldingPeriod[] {
  const inPeriod = transactions.filter((t) => {
    const at = t.tradeDate.slice(0, 10)
    return at > from && at <= to
  })

  const byInstrument = new Map<string, HoldingPeriod>()

  const row = (symbol: string, market: string, currency: Currency): HoldingPeriod => {
    const key = symbolKey(symbol, market as never)
    const existing = byInstrument.get(key)
    if (existing) return existing
    const created: HoldingPeriod = {
      symbol,
      market,
      currency,
      beginValue: null,
      endValue: null,
      invested: 0,
      divested: 0,
      dividends: 0,
    }
    byInstrument.set(key, created)
    return created
  }

  for (const holding of intelligence.analytics.holdings) {
    const entry = row(holding.symbol, holding.market, holding.currency)
    // The one value that is known: today's, from the batched quote call already made.
    entry.endValue = holding.baseMarketValue
  }

  for (const transaction of inPeriod) {
    const market = transaction.market ?? "US"
    const entry = row(transaction.symbol, market, baseCurrency)
    const gross = transaction.quantity * transaction.price
    if (transaction.side === "buy") entry.invested += gross + transaction.fee
    else entry.divested += gross - transaction.fee
  }

  for (const dividend of dividends) {
    const paid = dividend.paidOn.slice(0, 10)
    if (paid <= from || paid > to) continue
    /*
     * Matched by symbol across every market the portfolio holds it in.
     *
     * A dividend row records the symbol and not the market, so a symbol listed on two exchanges
     * cannot be attributed to one of them here. Rather than guessing, it lands on the instrument
     * that is actually held — and if none is, it is simply not attributed to a holding, which
     * leaves it in the residual where it is visible.
     */
    for (const [key, entry] of byInstrument) {
      if (key.endsWith(`:${dividend.symbol}`)) {
        entry.dividends += dividendAmounts(dividend).net
        break
      }
    }
  }

  return [...byInstrument.values()]
}

/**
 * A row per month in the window.
 *
 * `returnPct` is the simple return between the month's first and last recorded values **with the
 * month's capital flows removed** — a month whose value rose only because money was paid in reports
 * a return near zero, which is the correct answer and the one a naive month-on-month comparison
 * gets wrong.
 */
function buildMonthly(
  points: readonly ValuedPoint[],
  dividends: readonly { date: string; amount: number }[],
  cash: Parameters<typeof capitalFlowsBetween>[0],
  from: string,
  to: string,
): MonthlyRow[] {
  return monthsBetween(from, to).map((month) => {
    const inMonth = points.filter((p) => p.date.startsWith(month))
    const opening = inMonth[0]?.totalValue ?? null
    const closing = inMonth[inMonth.length - 1]?.totalValue ?? null

    const monthStart = `${month}-01`
    const monthEnd = `${month}-31`
    const flows = capitalFlowsBetween(cash, monthStart, monthEnd)
    const flowTotal = netFlow(flows)

    return {
      month,
      returnPct:
        opening !== null && closing !== null && opening > 0
          ? ((closing - flowTotal - opening) / opening) * 100
          : null,
      // Benchmark history per month is not stored, so this is honestly unavailable rather than
      // approximated from the period-level figure.
      benchmarkReturnPct: null,
      activeReturnPct: null,
      dividends: dividends
        .filter((d) => d.date.startsWith(month))
        .reduce((total, d) => total + d.amount, 0),
      netFlow: flowTotal,
      endingValue: closing,
      quality: inMonth.length === 0 ? "UNAVAILABLE" : (inMonth[inMonth.length - 1].quality ?? "COMPLETE"),
    }
  })
}
