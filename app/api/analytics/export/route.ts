import { fail, guarded } from "@/lib/api"
import { csvResponse, toCsv } from "@/lib/csv"
import { dividendAmounts } from "@/domain/dividends"
import { loadAnalytics } from "@/features/analytics/portfolio-analytics"
import { listCashTransactions } from "@/features/cash/queries"
import { listDividends } from "@/features/dividends/queries"
import { listTransactions } from "@/features/transactions/queries"

const DATASETS = ["transactions", "dividends", "cash", "summary"] as const
type Dataset = (typeof DATASETS)[number]

/** CSV export. Streams from the same queries the pages use, so an export can never disagree. */
export async function GET(request: Request) {
  return guarded(async () => {
    const url = new URL(request.url)
    const portfolioId = url.searchParams.get("portfolioId")
    const dataset = (url.searchParams.get("dataset") ?? "transactions") as Dataset

    if (!portfolioId) return fail("VALIDATION_ERROR", "portfolioId is required.")
    if (!DATASETS.includes(dataset)) {
      return fail("VALIDATION_ERROR", `dataset must be one of ${DATASETS.join(", ")}.`)
    }

    const stamp = new Date().toISOString().slice(0, 10)

    if (dataset === "transactions") {
      // RLS scopes every read below to the caller, so an unknown portfolio id exports nothing.
      const rows = await listTransactions(portfolioId)
      return csvResponse(
        `stockly-transactions-${stamp}.csv`,
        toCsv(
          ["Date", "Type", "Symbol", "Quantity", "Price", "Fee", "Total", "Notes"],
          rows.map((t) => [
            t.trade_date,
            t.side,
            t.symbol,
            t.quantity,
            t.price,
            t.fee,
            t.side === "buy" ? t.quantity * t.price + t.fee : t.quantity * t.price - t.fee,
            t.notes,
          ]),
        ),
      )
    }

    if (dataset === "dividends") {
      const rows = await listDividends(portfolioId)
      return csvResponse(
        `stockly-dividends-${stamp}.csv`,
        toCsv(
          ["Payment date", "Symbol", "Shares", "Dividend per share", "Gross", "Tax", "Fee", "Net", "Notes"],
          rows.map((d) => {
            const amounts = dividendAmounts({
              symbol: d.symbol,
              paidOn: d.payment_date,
              shares: d.shares,
              dividendPerShare: d.dividend_per_share,
              tax: d.tax,
              fee: d.fee,
            })
            return [
              d.payment_date,
              d.symbol,
              d.shares,
              d.dividend_per_share,
              amounts.gross,
              amounts.tax,
              amounts.fee,
              amounts.net,
              d.notes,
            ]
          }),
        ),
      )
    }

    if (dataset === "cash") {
      const rows = await listCashTransactions(portfolioId)
      return csvResponse(
        `stockly-cash-${stamp}.csv`,
        toCsv(
          ["Date", "Type", "Amount", "Currency", "Notes"],
          rows.map((c) => [c.occurred_on, c.kind, c.amount, c.currency, c.notes]),
        ),
      )
    }

    const bundle = await loadAnalytics(portfolioId)
    return csvResponse(
      `stockly-summary-${stamp}.csv`,
      toCsv(
        ["Metric", "Value"],
        [
          ["Total portfolio value", bundle.totalValue],
          ["Stock market value", bundle.summary.marketValue],
          ["Cash balance", bundle.cash.balance],
          ["Invested capital", bundle.summary.investedValue],
          ["Net contributed", bundle.cash.netContributed],
          ["Unrealized P&L", bundle.summary.unrealizedPnl],
          ["Realized P&L", bundle.summary.realizedPnl],
          ["Return %", bundle.summary.returnPct],
          ["Dividends received (net, all time)", bundle.dividends.summary.totalNet],
          ["Dividends (trailing 12 months)", bundle.dividends.summary.trailingTwelveMonths],
          ["Yield on current value %", bundle.dividends.yieldOnValue ?? "N/A"],
          ["Yield on cost %", bundle.dividends.yieldOnCost ?? "N/A"],
          ["Total fees", bundle.fees.total],
          ["Holdings", bundle.summary.holdingsCount],
          ["Win rate %", bundle.tradeStats.winRate ?? "N/A"],
        ],
      ),
    )
  })
}
