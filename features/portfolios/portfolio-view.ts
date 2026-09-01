import "server-only"

import { buildPortfolio } from "@/domain/holdings"
import type { Holding, PortfolioSummary } from "@/domain/types"
import { listTransactions, toDomain } from "@/features/transactions/queries"
import { getMarketDataProvider, isMarketDataError, type Quote } from "@/services/market-data"
import type { TransactionRow } from "@/types/database"

export type PortfolioView = {
  transactions: TransactionRow[]
  holdings: Holding[]
  summary: PortfolioSummary
  /** Company names and exchanges, keyed by symbol; empty when quotes were unavailable. */
  quotes: Map<string, Quote>
  /** Set when live prices could not be loaded — holdings then fall back to cost. */
  marketDataError: string | null
}

/**
 * The one place a portfolio is turned into numbers: read transactions, price them, run the engine.
 * Every page uses this, so the dashboard and the portfolio page can never disagree.
 *
 * One batched quote call covers every symbol in the portfolio, cached for 60s by the Next Data
 * Cache — a fifty-holding dashboard is one upstream request, not fifty.
 */
export async function loadPortfolioView(portfolioId: string): Promise<PortfolioView> {
  const transactions = await listTransactions(portfolioId)
  const symbols = [...new Set(transactions.map((t) => t.symbol))]

  let quotes = new Map<string, Quote>()
  let marketDataError: string | null = null

  if (symbols.length > 0) {
    try {
      quotes = await getMarketDataProvider().getQuotes(symbols)
    } catch (error) {
      // A provider outage must not take the portfolio down: the engine falls back to cost and the
      // page says so, rather than showing a fabricated loss or an error screen.
      marketDataError = isMarketDataError(error)
        ? error.message
        : "Unable to load market data. Please try again later."
      console.error("[portfolio-view] quotes failed", error)
    }
  }

  const { holdings, summary } = buildPortfolio(toDomain(transactions), (symbol) => {
    const quote = quotes.get(symbol)
    return quote ? { price: quote.price, previousClose: quote.previousClose ?? undefined } : undefined
  })

  return { transactions, holdings, summary, quotes, marketDataError }
}

/** Company names for the holdings table, taken from the quotes already fetched — no extra calls. */
export function namesFrom(quotes: Map<string, Quote>): Record<string, string | undefined> {
  return Object.fromEntries([...quotes.values()].map((q) => [q.symbol, q.name ?? undefined]))
}
