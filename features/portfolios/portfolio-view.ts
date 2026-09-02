import "server-only"

import { cache } from "react"
import { buildPortfolio } from "@/domain/holdings"
import { converterTo } from "@/domain/fx"
import { baseCurrencyOf, currencyOf, symbolKey, type Currency, type MarketId } from "@/domain/market"
import type { Holding, PortfolioSummary } from "@/domain/types"
import { listTransactions, toDomain } from "@/features/transactions/queries"
import { loadFxTable } from "@/services/fx"
import { getQuotesFor, type Quote } from "@/services/market-data"
import { createClient } from "@/lib/supabase/server"
import type { PortfolioRow, TransactionRow } from "@/types/database"

export type PortfolioView = {
  transactions: TransactionRow[]
  holdings: Holding[]
  summary: PortfolioSummary
  /** The portfolio's base currency — what every figure in `summary` is denominated in. */
  baseCurrency: Currency
  /** Company names and exchanges, keyed by `symbolKey`; empty when quotes were unavailable. */
  quotes: Map<string, Quote>
  /** Set when live prices could not be loaded — holdings then fall back to cost. */
  marketDataError: string | null
  /** Markets whose provider failed. A Thai outage leaves the US holdings priced. */
  staleMarkets: MarketId[]
  /** Currency pairs the FX provider could not answer; their holdings show "N/A", not 0. */
  missingFxPairs: readonly string[]
}

/** The base currency of a portfolio, from its row. Every page reads it through this. */
export function portfolioBaseCurrency(portfolio: Pick<PortfolioRow, "currency">): Currency {
  return baseCurrencyOf(portfolio.currency)
}

/**
 * The one place a portfolio is turned into numbers: read transactions, price them, translate them,
 * run the engine. Every page uses this, so the dashboard and the portfolio page can never disagree.
 *
 * Three upstream budgets, and all three are bounded by the *shape* of the portfolio rather than its
 * size: one batched quote call **per market**, one FX call **per currency pair**, and nothing per
 * holding. A fifty-holding portfolio spanning two markets is two quote requests and one rate.
 */
export const loadPortfolioView = cache(async (portfolioId: string): Promise<PortfolioView> => {
  const [transactions, baseCurrency] = await Promise.all([
    listTransactions(portfolioId),
    baseCurrencyFor(portfolioId),
  ])

  const instruments = dedupeInstruments(transactions)
  const domainTransactions = toDomain(transactions)

  // Quotes and rates are independent, so they go out together. Neither can take the page down.
  const [priced, fx] = await Promise.all([
    instruments.length > 0
      ? getQuotesFor(instruments)
      : Promise.resolve({ quotes: new Map<string, Quote>(), failed: [] as MarketId[], error: null }),
    loadFxTable(baseCurrency, [...new Set(instruments.map((i) => currencyOf(i.market)))]),
  ])

  // A provider outage must not take the portfolio down: the engine falls back to cost and the
  // page says so, rather than showing a fabricated loss or an error screen.
  const marketDataError = priced.error
    ? priced.error.message
    : null

  const { holdings, summary } = buildPortfolio(
    domainTransactions,
    (symbol, market) => {
      const quote = priced.quotes.get(symbolKey(symbol, market))
      return quote ? { price: quote.price, previousClose: quote.previousClose ?? undefined } : undefined
    },
    { baseCurrency, convert: converterTo(baseCurrency, fx, new Date()) },
  )

  return {
    transactions,
    holdings,
    summary,
    baseCurrency,
    quotes: priced.quotes,
    marketDataError,
    staleMarkets: priced.failed,
    missingFxPairs: fx.missing,
  }
})

/** Distinct instruments in a transaction history, so quotes are fetched once per instrument. */
export function dedupeInstruments(
  transactions: readonly Pick<TransactionRow, "symbol" | "market">[],
): { symbol: string; market: MarketId }[] {
  const out = new Map<string, { symbol: string; market: MarketId }>()
  for (const row of transactions) {
    const market = (row.market as MarketId) ?? "US"
    out.set(symbolKey(row.symbol, market), { symbol: row.symbol, market })
  }
  return [...out.values()]
}

/**
 * The portfolio's base currency, read from its row. RLS scopes the lookup, and a portfolio that
 * cannot be read falls back to USD rather than throwing — the transactions still have to render.
 */
const baseCurrencyFor = cache(async (portfolioId: string): Promise<Currency> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from("portfolios")
    .select("currency")
    .eq("id", portfolioId)
    .maybeSingle()
  return baseCurrencyOf(data?.currency)
})

/**
 * Company names for the holdings table, taken from the quotes already fetched — no extra calls.
 * Keyed by bare symbol because that is what the table renders; two venues sharing a spelling is
 * rare enough that a name collision costs a label, not a number.
 */
export function namesFrom(quotes: Map<string, Quote>): Record<string, string | undefined> {
  return Object.fromEntries([...quotes.values()].map((q) => [q.symbol, q.name ?? undefined]))
}
