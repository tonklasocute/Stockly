import {
  METRIC_LABELS,
  OPERATOR_LABELS,
  SCREENER_METRICS,
  SCREENER_OPERATORS,
} from "@/domain/screener"
import type {
  MarketFacts,
  PortfolioFacts,
  ScreenExplanation,
  StockFacts,
  WatchlistFacts,
} from "./facts"

/**
 * Turning retrieved facts into the text block the model reads.
 *
 * Pure and dependency-free, so the one rule that matters here is unit-testable: **a null reading
 * renders as "unavailable", never as 0**. A model handed "RSI: 0" will faithfully describe a stock
 * as maximally oversold; handed "RSI: unavailable" it says the data is missing.
 */

/** Null is "unavailable", always spelled out. A fabricated zero in a financial figure is worse. */
const num = (value: number | null | undefined, digits = 2, suffix = ""): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "unavailable"
    : `${value.toFixed(digits)}${suffix}`

const line = (label: string, value: string) => `${label}: ${value}`


export function renderStock(stock: StockFacts): string {
  const rows = [
    `### ${stock.symbol}${stock.name ? ` — ${stock.name}` : ""}`,
    line("Price", stock.price === null ? "unavailable" : `${num(stock.price)} ${stock.currency}`),
    line("Change today", num(stock.changePct, 2, "%")),
    line("Trend", stock.trend),
    line("Market stage", stock.stage),
    line("Technical score", stock.score === null ? "unavailable" : `${stock.score}/100 (${stock.scoreVersion})`),
    line("RSI (14)", num(stock.rsi, 1)),
    line("ADX (14)", num(stock.adx, 1)),
    line("MACD histogram", num(stock.macdHistogram, 4)),
    line("Relative volume", stock.relativeVolume === null ? "unavailable" : `${num(stock.relativeVolume, 2)}x`),
    line("ATR as % of price", num(stock.atrPct, 2, "%")),
    line("50 EMA", num(stock.ema50)),
    line("200 EMA", num(stock.ema200)),
    line("Bars analysed", String(stock.candleCount)),
    line(
      "Indicators calculated at",
      stock.indicatorsAsOf ?? "unavailable",
    ),
    line("Indicators delayed", stock.indicatorsDelayed ? "yes — older than the freshness window" : "no"),
  ]

  if (stock.components.length > 0) {
    rows.push("Score components:")
    for (const c of stock.components) {
      rows.push(`  - ${c.label}: ${c.points}/${c.max} — ${c.reason}`)
    }
  }
  if (stock.signals.length > 0) rows.push(`Conditions currently true: ${stock.signals.join("; ")}`)

  if (stock.history) {
    const h = stock.history
    rows.push(
      line("52-week high", num(h.high52w)),
      line("52-week low", num(h.low52w)),
      line("Distance from 52-week high", num(h.fromHighPct, 1, "%")),
      line("1-month return", num(h.return1mPct, 1, "%")),
      line("3-month return", num(h.return3mPct, 1, "%")),
      line("Annualised volatility", num(h.volatilityPct, 1, "%")),
    )
  }

  rows.push(line("On the user's watchlist", stock.watched ? "yes" : "no"))
  if (stock.position) {
    const p = stock.position
    rows.push(
      "The user holds this stock:",
      `  - shares ${num(p.quantity, 4)}, average cost ${num(p.averageCost)}, market value ${num(p.marketValue)}`,
      `  - unrealised P&L ${num(p.unrealizedPnl)}, return ${num(p.returnPct, 2, "%")}, ${num(p.weightPct, 2, "%")} of the portfolio`,
    )
  } else {
    rows.push("The user does not hold this stock.")
  }

  return rows.join("\n")
}

export function renderPortfolio(p: PortfolioFacts): string {
  const rows = [
    `### Portfolio: ${p.name}`,
    line("Total value (holdings + cash)", `${num(p.totalValue)} ${p.currency}`),
    line("Invested capital", num(p.investedValue)),
    line("Cash", num(p.cashValue)),
    line("Unrealised P&L", num(p.unrealizedPnl)),
    line("Realised P&L", num(p.realizedPnl)),
    line("Total return", num(p.returnPct, 2, "%")),
    line("Today's change", num(p.todayChangePct, 2, "%")),
    line("Holdings", String(p.holdingCount)),
    line(
      "Largest position",
      p.largest ? `${p.largest.symbol} at ${num(p.largest.weightPct, 2, "%")}` : "unavailable",
    ),
    line("Top 5 positions combined", num(p.topWeightsPct, 2, "%")),
  ]
  if (p.sectors.length > 0) {
    rows.push(`Sector weights: ${p.sectors.map((s) => `${s.label} ${num(s.weightPct, 1, "%")}`).join(", ")}`)
  }
  if (p.gainers.length > 0) {
    rows.push(`Best performers: ${p.gainers.map((m) => `${m.symbol} ${num(m.returnPct, 1, "%")}`).join(", ")}`)
  }
  if (p.losers.length > 0) {
    rows.push(`Worst performers: ${p.losers.map((m) => `${m.symbol} ${num(m.returnPct, 1, "%")}`).join(", ")}`)
  }
  if (p.risk) {
    rows.push(
      line("Time-weighted return", num(p.risk.timeWeightedReturnPct, 2, "%")),
      line("Volatility (annualised)", num(p.risk.volatilityPct, 2, "%")),
      line("Sharpe ratio", num(p.risk.sharpe, 2)),
      line("Maximum drawdown", num(p.risk.maxDrawdownPct, 2, "%")),
      line("Current drawdown", num(p.risk.currentDrawdownPct, 2, "%")),
      line("Beta vs benchmark", num(p.risk.beta, 2)),
    )
  }
  if (p.goals.length > 0) {
    rows.push(
      `Goals: ${p.goals
        .map((g) => `${g.type} ${num(g.progressPct, 1, "%")}${g.achieved ? " (reached)" : ""}`)
        .join(", ")}`,
    )
  }
  if (p.insights.length > 0) {
    // Handed over already decided. The model may restate an insight in plainer words; it has no
    // figures with which to invent another, and it is told so.
    rows.push(
      "Insights already determined by Stockly's rules (do not add to this list, do not remove from it):",
      ...p.insights.map((i) => `  - [${i.severity}] ${i.title} — ${i.detail}`),
    )
  }
  if (p.technicals.length > 0) {
    rows.push(
      `Technical conditions of holdings: ${p.technicals
        .map((t) => `${t.symbol} ${t.trend}${t.score === null ? "" : ` (score ${t.score})`}`)
        .join(", ")}`,
    )
  }
  return rows.join("\n")
}

export function renderWatchlist(w: WatchlistFacts): string {
  return [
    "### Watchlist",
    line("Stocks", String(w.count)),
    line("Bullish / neutral / bearish", `${w.bullish} / ${w.neutral} / ${w.bearish}`),
    ...w.rows.map(
      (r) =>
        `  - ${r.symbol}: trend ${r.trend}, score ${r.score ?? "unavailable"}, RSI ${num(r.rsi, 1)}, relative volume ${r.relativeVolume === null ? "unavailable" : `${num(r.relativeVolume, 2)}x`}`,
    ),
  ].join("\n")
}

export function renderMarket(m: MarketFacts): string {
  return [
    "### Market conditions",
    "Stockly has no index feed on this plan, so breadth is measured across the symbols it tracks,",
    "not across the whole market. Say so if you describe it.",
    line("Symbols tracked", String(m.universeSize)),
    line("Bullish / neutral / bearish", `${m.bullish} / ${m.neutral} / ${m.bearish}`),
    line("Median technical score", m.medianScore === null ? "unavailable" : String(m.medianScore)),
    line("Trading above average volume", String(m.aboveAverageVolume)),
    line("Indicators calculated at", m.asOf ?? "unavailable"),
    line("Indicators delayed", m.delayed ? "yes" : "no"),
  ].join("\n")
}

export function renderScreen(s: ScreenExplanation): string {
  return [
    `### Screen "${s.screenName}" evaluated against ${s.symbol}`,
    line("Passes every condition", s.passedAll ? "yes" : "no"),
    ...s.results.map((r) => `  - ${r.passed ? "PASS" : "FAIL"} ${r.condition} (actual: ${r.actual})`),
  ].join("\n")
}

/** The metric and operator vocabulary, so the model proposes filters the engine will accept. */
export function renderScreenerVocabulary(): string {
  return [
    "### Allowed screener metrics",
    ...SCREENER_METRICS.map((m) => `  - ${m} (${METRIC_LABELS[m]})`),
    "### Allowed operators",
    ...SCREENER_OPERATORS.map((o) => `  - ${o} (${OPERATOR_LABELS[o]})`),
    "CROSS_ABOVE and CROSS_BELOW are valid only for MACD_HISTOGRAM and EMA50_VS_EMA200.",
    "TREND takes bullish, bearish or neutral. Every other metric takes a number.",
  ].join("\n")
}

