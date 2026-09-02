import { Metric } from "@/components/metric"
import { MIN_RETURN_OBSERVATIONS, TRADING_DAYS_PER_YEAR } from "@/domain/risk"
import { formatDate, formatOptionalPercent } from "@/lib/format"
import type { RiskBundle } from "../loader"

/**
 * Every advanced metric carries a one-line explanation, and every unavailable one says what is
 * missing rather than showing a blank. A user who cannot tell "we did not compute this" from "this
 * is zero" has been told something false by omission.
 */
const EXPLANATIONS = {
  volatility:
    `Standard deviation of the portfolio's returns, annualised by √${TRADING_DAYS_PER_YEAR}. ` +
    "Measured on returns with deposits and withdrawals removed, so paying in is not counted as movement.",
  sharpe:
    "Return relative to volatility. Higher is generally read as better, but the number depends " +
    "entirely on the period and the risk-free assumption stated beside it.",
  drawdown:
    "The deepest peak-to-trough fall in the return index. Deposits cannot disguise one and " +
    "withdrawals cannot create one, because the index removes both.",
  beta:
    "How much the portfolio moved relative to its benchmark. 1 means it moved with the index, " +
    "2 means twice as far in both directions.",
  concentration:
    "The Herfindahl index restated as a position count: how many equally-sized positions this " +
    "portfolio behaves like, whatever number it actually holds.",
} as const

function Unavailable({ reason }: { reason: string }) {
  return (
    <span className="text-muted-foreground">
      N/A <span className="text-xs font-normal">· {reason}</span>
    </span>
  )
}

export function RiskPanel({ risk }: { risk: RiskBundle }) {
  const tooFewObservations = `needs ${MIN_RETURN_OBSERVATIONS} valuations, has ${risk.observations}`

  return (
    <div className="space-y-4">
      <dl className="grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
        <Metric
          label="Volatility (annualised)"
          value={
            risk.volatility ? (
              formatOptionalPercent(risk.volatility.annualisedPct, { signed: false })
            ) : (
              <Unavailable reason={tooFewObservations} />
            )
          }
          hint={EXPLANATIONS.volatility}
        />
        <Metric
          label="Sharpe ratio"
          value={
            risk.sharpe ? (
              risk.sharpe.ratio.toFixed(2)
            ) : (
              <Unavailable reason={risk.volatility ? "the portfolio has not moved" : tooFewObservations} />
            )
          }
          hint={
            risk.sharpe
              ? `${EXPLANATIONS.sharpe} Risk-free rate assumed at ${risk.sharpe.riskFreeRatePct}%, over ${risk.sharpe.observations} observations.`
              : EXPLANATIONS.sharpe
          }
        />
        <Metric
          label="Maximum drawdown"
          value={
            risk.drawdown ? (
              formatOptionalPercent(risk.drawdown.maxDrawdownPct, { signed: false })
            ) : (
              <Unavailable reason="needs more valuation history" />
            )
          }
          hint={
            risk.drawdown
              ? `${formatDate(risk.drawdown.peakDate)} to ${formatDate(risk.drawdown.troughDate)}, ${risk.drawdown.declineDays} days. ` +
                (risk.drawdown.recoveredOn
                  ? `Recovered ${formatDate(risk.drawdown.recoveredOn)}.`
                  : "Not yet recovered.")
              : EXPLANATIONS.drawdown
          }
        />
        <Metric
          label="Current drawdown"
          value={
            risk.drawdown ? (
              formatOptionalPercent(risk.drawdown.currentDrawdownPct, { signed: false })
            ) : (
              <Unavailable reason="needs more valuation history" />
            )
          }
          hint="How far below its running peak the portfolio stands today."
        />
        <Metric
          label="Beta"
          value={
            risk.beta ? (
              risk.beta.beta.toFixed(2)
            ) : (
              <Unavailable reason="needs a benchmark with matching history" />
            )
          }
          hint={
            risk.beta
              ? `${EXPLANATIONS.beta} R² ${risk.beta.rSquared ?? "N/A"} over ${risk.beta.observations} observations.`
              : EXPLANATIONS.beta
          }
        />
        <Metric
          label="Effective positions"
          value={
            risk.concentration ? (
              String(risk.concentration.effectivePositions)
            ) : (
              <Unavailable reason="no priced positions" />
            )
          }
          hint={
            risk.concentration
              ? `${EXPLANATIONS.concentration} Holds ${risk.concentration.positions}; HHI ${risk.concentration.hhi}.`
              : EXPLANATIONS.concentration
          }
        />
      </dl>

      {risk.limitations.length > 0 && (
        <ul className="text-muted-foreground space-y-1 border-t pt-3 text-xs">
          {risk.limitations.map((limitation) => (
            <li key={limitation}>{limitation}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
