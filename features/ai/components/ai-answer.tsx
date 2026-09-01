"use client"

import Link from "next/link"
import { AlertTriangle, CheckCircle2, Clock, Database, ShieldAlert, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { INTENT_LABELS, type AIIntent, type DataCompleteness } from "@/domain/ai"
import type {
  GroundedData,
  MarketFacts,
  PortfolioFacts,
  ScreenExplanation,
  StockFacts,
  WatchlistFacts,
} from "@/features/ai/facts"
import type { Narrative } from "@/features/ai/schema"
import { formatCurrency, formatPercent, formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"

/**
 * How an answer is shown.
 *
 * Two rules shape this whole file:
 *
 * **Fact and interpretation are visually separate.** The figures come from Stockly's engines and
 * are rendered from the structured payload; the prose came from a language model and is labelled
 * as such. A reader must never have to guess which is which.
 *
 * **Nothing is ever rendered as HTML.** Model output is untrusted content, so every string here
 * goes through a React text node — escaped by construction. There is no markdown parser, no
 * sanitiser to keep patched and no `dangerouslySetInnerHTML` anywhere in this feature; a test
 * asserts that. The system prompt asks for plain sentences, so there is nothing to lose.
 */

export type AIAnswer = {
  intent: AIIntent
  symbols: string[]
  narrative: Narrative
  grounded: GroundedData
  completeness: DataCompleteness
  dataAsOf: string
  delayed: boolean
  provider: string
  model: string
  safetyFiltered: boolean
}

const num = (value: number | null | undefined, digits = 2, suffix = "") =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "N/A"
    : `${value.toFixed(digits)}${suffix}`

/** Splits on blank lines and renders text nodes. Never interprets markup. */
function Prose({ text }: { text: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0)
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {paragraphs.map((paragraph, index) => (
        <p key={index}>{paragraph}</p>
      ))}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="tabular text-sm font-medium">{value}</dd>
    </div>
  )
}

function StockCard({ stock }: { stock: StockFacts }) {
  return (
    <div className="space-y-3 rounded-xl border p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link href={`/stocks/${stock.symbol}`} className="font-semibold underline-offset-4 hover:underline">
          {stock.symbol}
          {stock.name && <span className="text-muted-foreground ml-2 text-xs font-normal">{stock.name}</span>}
        </Link>
        <Badge
          variant="outline"
          className={cn(
            "capitalize",
            stock.trend === "bullish" && "border-gain/40 text-gain",
            stock.trend === "bearish" && "border-loss/40 text-loss",
          )}
        >
          {stock.trend}
        </Badge>
      </div>

      <dl className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        <Metric
          label="Price"
          value={stock.price === null ? "N/A" : formatCurrency(stock.price, stock.currency)}
        />
        <Metric
          label="Change"
          value={stock.changePct === null ? "N/A" : formatPercent(stock.changePct)}
        />
        <Metric label="Score" value={stock.score === null ? "N/A" : `${stock.score}/100`} />
        <Metric label="RSI (14)" value={num(stock.rsi, 1)} />
        <Metric label="ADX (14)" value={num(stock.adx, 1)} />
        <Metric
          label="Rel volume"
          value={stock.relativeVolume === null ? "N/A" : `${num(stock.relativeVolume, 2)}×`}
        />
        <Metric label="ATR % of price" value={num(stock.atrPct, 2, "%")} />
        <Metric label="Stage" value={stock.stage} />
      </dl>

      {stock.components.length > 0 && (
        <div className="space-y-1 border-t pt-3">
          <p className="text-muted-foreground text-xs font-medium">
            How the score was reached — every component shows the rule that produced it
          </p>
          <ul className="space-y-1">
            {stock.components.map((component) => (
              <li key={component.key} className="flex gap-2 text-xs">
                <span className="tabular w-14 shrink-0 font-medium">
                  {component.points}/{component.max}
                </span>
                <span className="w-20 shrink-0">{component.label}</span>
                <span className="text-muted-foreground">{component.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {stock.position && (
        <p className="text-muted-foreground border-t pt-3 text-xs">
          You hold {num(stock.position.quantity, 4)} shares · average cost{" "}
          {formatCurrency(stock.position.averageCost, stock.currency)} · return{" "}
          {formatPercent(stock.position.returnPct)} · {num(stock.position.weightPct, 2, "%")} of the
          portfolio
        </p>
      )}

      {stock.indicatorsDelayed && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Clock className="size-3.5" aria-hidden />
          Indicators may be delayed
          {stock.indicatorsAsOf ? ` — calculated ${formatTime(stock.indicatorsAsOf)}` : ""}.
        </p>
      )}
    </div>
  )
}

function PortfolioCard({ portfolio }: { portfolio: PortfolioFacts }) {
  return (
    <div className="space-y-3 rounded-xl border p-3.5">
      <p className="font-semibold">{portfolio.name}</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Total value" value={formatCurrency(portfolio.totalValue, portfolio.currency)} />
        <Metric label="Invested" value={formatCurrency(portfolio.investedValue, portfolio.currency)} />
        <Metric label="Cash" value={formatCurrency(portfolio.cashValue, portfolio.currency)} />
        <Metric
          label="Return"
          value={portfolio.returnPct === null ? "N/A" : formatPercent(portfolio.returnPct)}
        />
        <Metric
          label="Unrealised P&L"
          value={formatCurrency(portfolio.unrealizedPnl, portfolio.currency)}
        />
        <Metric
          label="Realised P&L"
          value={formatCurrency(portfolio.realizedPnl, portfolio.currency)}
        />
        <Metric label="Holdings" value={String(portfolio.holdingCount)} />
        <Metric
          label="Largest"
          value={
            portfolio.largest
              ? `${portfolio.largest.symbol} ${num(portfolio.largest.weightPct, 1, "%")}`
              : "N/A"
          }
        />
      </dl>
      {portfolio.sectors.length > 0 && (
        <p className="text-muted-foreground border-t pt-3 text-xs">
          Sectors:{" "}
          {portfolio.sectors.map((s) => `${s.label} ${num(s.weightPct, 1, "%")}`).join(" · ")}
        </p>
      )}
    </div>
  )
}

function WatchlistCard({ watchlist }: { watchlist: WatchlistFacts }) {
  return (
    <div className="space-y-3 rounded-xl border p-3.5">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="font-semibold">Watchlist</p>
        <p className="text-muted-foreground text-xs">
          {watchlist.count} stocks · {watchlist.bullish} bullish · {watchlist.neutral} neutral ·{" "}
          {watchlist.bearish} bearish
        </p>
      </div>
      <ul className="divide-y">
        {watchlist.rows.map((row) => (
          <li key={row.symbol} className="flex items-center justify-between gap-3 py-1.5 text-xs">
            <Link href={`/stocks/${row.symbol}`} className="font-medium underline-offset-4 hover:underline">
              {row.symbol}
            </Link>
            <span className="text-muted-foreground tabular">
              {row.trend} · score {row.score ?? "N/A"} · RSI {num(row.rsi, 0)} ·{" "}
              {row.relativeVolume === null ? "N/A" : `${num(row.relativeVolume, 2)}×`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MarketCard({ market }: { market: MarketFacts }) {
  return (
    <div className="space-y-3 rounded-xl border p-3.5">
      <p className="font-semibold">Market conditions</p>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Symbols tracked" value={String(market.universeSize)} />
        <Metric label="Bullish" value={String(market.bullish)} />
        <Metric label="Neutral" value={String(market.neutral)} />
        <Metric label="Bearish" value={String(market.bearish)} />
        <Metric label="Median score" value={market.medianScore === null ? "N/A" : String(market.medianScore)} />
        <Metric label="Above average volume" value={String(market.aboveAverageVolume)} />
      </dl>
      <p className="text-muted-foreground border-t pt-3 text-xs">
        Breadth is measured across the stocks Stockly tracks, not the whole market — index data is
        not available on this plan.
      </p>
    </div>
  )
}

function ScreenCard({ screen }: { screen: ScreenExplanation }) {
  return (
    <div className="space-y-2 rounded-xl border p-3.5">
      <p className="font-semibold">
        {screen.symbol} against “{screen.screenName}”
      </p>
      <ul className="space-y-1">
        {screen.results.map((result, index) => (
          <li key={index} className="flex items-start gap-2 text-xs">
            {result.passed ? (
              <CheckCircle2 className="text-gain mt-0.5 size-3.5 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="text-loss mt-0.5 size-3.5 shrink-0" aria-hidden />
            )}
            <span>
              <span className="sr-only">{result.passed ? "Passed: " : "Failed: "}</span>
              {result.condition}
              <span className="text-muted-foreground"> — actual {result.actual}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AIAnswerView({ answer }: { answer: AIAnswer }) {
  const { grounded, narrative, completeness } = answer
  const hasData =
    grounded.stocks.length > 0 ||
    grounded.portfolio !== null ||
    grounded.watchlist !== null ||
    grounded.market !== null ||
    grounded.screen !== null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="gap-1.5">
          <Sparkles className="size-3.5" aria-hidden />
          {INTENT_LABELS[answer.intent]}
        </Badge>
        <Badge variant="outline" className="gap-1.5">
          <Database className="size-3.5" aria-hidden />
          Data coverage {completeness.coveragePct}%
        </Badge>
        {answer.delayed && (
          <Badge variant="outline" className="gap-1.5">
            <Clock className="size-3.5" aria-hidden />
            Some data may be delayed
          </Badge>
        )}
      </div>

      {/* Fact first. The figures below are Stockly's, not the model's. */}
      {hasData && (
        <section className="space-y-3">
          <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Data — from Stockly
          </h3>
          {grounded.stocks.map((stock) => (
            <StockCard key={stock.symbol} stock={stock} />
          ))}
          {grounded.portfolio && <PortfolioCard portfolio={grounded.portfolio} />}
          {grounded.watchlist && <WatchlistCard watchlist={grounded.watchlist} />}
          {grounded.market && <MarketCard market={grounded.market} />}
          {grounded.screen && <ScreenCard screen={grounded.screen} />}
        </section>
      )}

      {grounded.unknownSymbols.length > 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-3.5 py-2.5 text-sm">
          Not found in the supported universe: {grounded.unknownSymbols.join(", ")}. Stockly has no
          data for those, so nothing is shown for them.
        </p>
      )}

      {grounded.marketDataError && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-3.5 py-2.5 text-sm">
          {grounded.marketDataError} Prices are unavailable for this answer.
        </p>
      )}

      {/* Interpretation second, and clearly marked as generated. */}
      <section className="space-y-3">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          AI interpretation
        </h3>

        {answer.safetyFiltered && (
          <p className="flex items-start gap-2 rounded-xl border border-dashed px-3.5 py-2.5 text-sm">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            The generated text was withheld because it used advice or prediction language, which
            Stockly does not publish. The data above is unaffected.
          </p>
        )}

        <Prose text={narrative.summary} />
        {narrative.interpretation && <Prose text={narrative.interpretation} />}

        {(narrative.positives.length > 0 || narrative.risks.length > 0) && (
          <div className="grid gap-4 sm:grid-cols-2">
            {narrative.positives.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold">Constructive in the data</p>
                <ul className="space-y-1">
                  {narrative.positives.map((item, index) => (
                    <li key={index} className="text-muted-foreground flex gap-2 text-xs">
                      <span aria-hidden>·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {narrative.risks.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold">Risks in the data</p>
                <ul className="space-y-1">
                  {narrative.risks.map((item, index) => (
                    <li key={index} className="text-muted-foreground flex gap-2 text-xs">
                      <span aria-hidden>·</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {narrative.notes && <p className="text-muted-foreground text-xs">{narrative.notes}</p>}
      </section>

      <footer className="text-muted-foreground space-y-1 border-t pt-3 text-xs">
        <p>
          Based on Stockly market and technical data · updated {formatTime(answer.dataAsOf)}
          {completeness.missing.length > 0 &&
            ` · unavailable: ${completeness.missing.slice(0, 4).join(", ")}`}
        </p>
        <p>
          Written by {answer.provider}/{answer.model}. Stockly AI describes data; it does not give
          investment advice, price targets or forecasts. Analysis confidence reflects data coverage
          only — it is not a probability that a price will move.
        </p>
      </footer>
    </div>
  )
}
