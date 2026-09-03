import type { CorporateEvent } from "@/domain/corporate-events"
import type { FinancialStatement } from "@/domain/fundamentals"
import { currencyOf, type MarketId } from "@/domain/market"
import type { DividendPayment, FundamentalDataProvider, StatementRequest } from "./types"

/**
 * Deterministic fundamentals for development and tests.
 *
 * Every figure is derived from a hash of the symbol, so the same symbol always produces the same
 * statements — a screener test that depends on NVDA's margin gives the same answer on every run.
 *
 * **It is obviously synthetic, on purpose.** The revenues are small round-ish numbers rather than
 * plausible billions, so a mock statement rendered by mistake in a production build reads as a
 * mistake rather than as a company's real accounts. Deceiving ourselves with realistic-looking fake
 * financials is the failure mode a mock provider invites.
 */

function seed(symbol: string): number {
  let hash = 0
  for (let i = 0; i < symbol.length; i += 1) hash = (hash * 31 + symbol.charCodeAt(i)) % 100_000
  return hash
}

/** A stable pseudo-random in [min, max] for one symbol and one field. */
function value(symbol: string, field: string, min: number, max: number): number {
  const n = seed(`${symbol}:${field}`)
  return min + (n % 1_000) / 1_000 * (max - min)
}

function statementFor(symbol: string, market: MarketId, year: number, quarter: number | null): FinancialStatement {
  const scale = quarter === null ? 1 : 0.25
  const revenue = Math.round(value(symbol, "revenue", 800, 4_000) * scale)
  const grossMargin = value(symbol, "gm", 0.25, 0.7)
  const operatingMargin = grossMargin * value(symbol, "om", 0.4, 0.8)
  const netMargin = operatingMargin * value(symbol, "nm", 0.6, 0.9)
  const shares = Math.round(value(symbol, "shares", 80, 400))

  const netIncome = Math.round(revenue * netMargin)
  const equity = Math.round(revenue * value(symbol, "eq", 0.8, 2.5))

  return {
    symbol,
    market,
    currency: currencyOf(market),
    period: {
      type: quarter === null ? "ANNUAL" : "QUARTERLY",
      fiscalYear: year,
      fiscalQuarter: quarter,
      reportDate: quarter === null ? `${year + 1}-02-20` : `${year}-${String(quarter * 3 + 1).padStart(2, "0")}-20`,
      periodEnd: quarter === null ? `${year}-12-31` : `${year}-${String(quarter * 3).padStart(2, "0")}-30`,
    },
    income: {
      revenue,
      grossProfit: Math.round(revenue * grossMargin),
      operatingIncome: Math.round(revenue * operatingMargin),
      ebitda: Math.round(revenue * (operatingMargin + 0.05)),
      netIncome,
      eps: Number((netIncome / shares).toFixed(2)),
      epsDiluted: Number(((netIncome / shares) * 0.97).toFixed(2)),
      sharesDiluted: shares,
    },
    balance: {
      totalAssets: Math.round(equity * 1.7),
      totalLiabilities: Math.round(equity * 0.7),
      totalEquity: equity,
      cashAndEquivalents: Math.round(revenue * value(symbol, "cash", 0.1, 0.5)),
      totalDebt: Math.round(equity * value(symbol, "debt", 0.05, 0.9)),
      currentAssets: Math.round(equity * 0.6),
      currentLiabilities: Math.round(equity * 0.3),
    },
    cashFlow: {
      operatingCashFlow: Math.round(netIncome * value(symbol, "ocf", 0.9, 1.6)),
      capitalExpenditure: -Math.round(revenue * value(symbol, "capex", 0.02, 0.15)),
      investingCashFlow: -Math.round(revenue * 0.1),
      financingCashFlow: -Math.round(revenue * 0.05),
      dividendsPaid: -Math.round(netIncome * 0.2),
    },
    source: "mock",
    fetchedAt: new Date().toISOString(),
  }
}

export const mockFundamentalProvider: FundamentalDataProvider = {
  name: "mock",

  capabilities: {
    markets: ["US", "SET"],
    periods: ["ANNUAL", "QUARTERLY", "TTM"],
    statements: true,
    corporateEvents: true,
    earningsCalendar: true,
    dividendHistory: true,
    // Even the mock refuses to supply these: a forward estimate is a claim about the future, and
    // inventing one in development is how a forward multiple ends up in the UI.
    forwardEstimates: false,
  },

  async getFinancialStatements(request: StatementRequest): Promise<FinancialStatement[]> {
    if (request.periodType === "TTM") return []
    const thisYear = new Date().getUTCFullYear()
    const out: FinancialStatement[] = []

    for (let i = 0; i < Math.min(request.limit, 12); i += 1) {
      if (request.periodType === "ANNUAL") {
        out.push(statementFor(request.symbol, request.market, thisYear - 1 - i, null))
      } else {
        const quartersBack = i
        const year = thisYear - Math.floor(quartersBack / 4)
        const quarter = 4 - (quartersBack % 4)
        out.push(statementFor(request.symbol, request.market, year, quarter))
      }
    }
    return out
  },

  async getSharesOutstanding(symbol: string): Promise<number | null> {
    return Math.round(value(symbol, "shares", 80, 400))
  },

  async getCorporateEvents(symbol: string, market: MarketId): Promise<CorporateEvent[]> {
    const now = new Date()
    const inDays = (days: number) =>
      new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10)

    return [
      {
        symbol,
        market,
        type: "EARNINGS",
        date: inDays(Math.round(value(symbol, "earnings", 5, 60))),
        // Deliberately estimated: a mock must exercise the path the UI takes for an unconfirmed
        // date, which is the one most likely to be got wrong.
        estimated: true,
        status: "UPCOMING",
        title: "Quarterly results",
        detail: null,
        amountPerShare: null,
        currency: null,
        ratio: null,
        source: "mock",
        fetchedAt: now.toISOString(),
      },
      {
        symbol,
        market,
        type: "EX_DIVIDEND",
        date: inDays(Math.round(value(symbol, "exdiv", 3, 45))),
        estimated: false,
        status: "UPCOMING",
        title: "Ex-dividend date",
        detail: null,
        amountPerShare: Number(value(symbol, "div", 0.1, 1.2).toFixed(2)),
        currency: currencyOf(market),
        ratio: null,
        source: "mock",
        fetchedAt: now.toISOString(),
      },
    ]
  },

  async getDividendHistory(symbol: string, market: MarketId): Promise<DividendPayment[]> {
    const perShare = Number(value(symbol, "div", 0.1, 1.2).toFixed(2))
    const now = new Date()
    return Array.from({ length: 8 }, (_, i) => {
      const at = new Date(now.getTime() - (i + 1) * 91 * 86_400_000)
      return {
        exDate: at.toISOString().slice(0, 10),
        paymentDate: new Date(at.getTime() + 14 * 86_400_000).toISOString().slice(0, 10),
        recordDate: null,
        // Slightly lower further back, so growth is a real number rather than always zero.
        amountPerShare: Number((perShare * (1 - i * 0.01)).toFixed(4)),
        currency: currencyOf(market),
      }
    })
  },
}
