import "server-only"

import { buildPortfolio } from "@/domain/holdings"
import type { Holding, PortfolioSummary } from "@/domain/types"
import { listTransactions, toDomain } from "@/features/transactions/queries"
import { getMarketDataProvider } from "@/services/market-data"
import type { TransactionRow } from "@/types/database"

export type PortfolioView = {
  transactions: TransactionRow[]
  holdings: Holding[]
  summary: PortfolioSummary
}

/**
 * The one place a portfolio is turned into numbers: read transactions, price them, run the engine.
 * Every page uses this, so the dashboard and the portfolio page can never disagree.
 */
export async function loadPortfolioView(portfolioId: string): Promise<PortfolioView> {
  const transactions = await listTransactions(portfolioId)
  const symbols = [...new Set(transactions.map((t) => t.symbol))]
  const quotes = symbols.length
    ? await getMarketDataProvider().getQuotes(symbols)
    : new Map<string, { price: number }>()

  const { holdings, summary } = buildPortfolio(
    toDomain(transactions),
    (symbol) => quotes.get(symbol)?.price,
  )

  return { transactions, holdings, summary }
}
