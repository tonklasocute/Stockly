import { Metric, Section } from "@/components/metric"
import { Delta, Percent } from "@/components/value"
import { UNAVAILABLE_REASONS, describeContribution, type AttributionResult, type Contribution } from "@/domain/attribution"
import { formatCurrency, formatOptionalPercent } from "@/lib/format"
import type { Currency } from "@/domain/market"

/**
 * What the portfolio's return was made of.
 *
 * Three things this panel is careful about, each of which is a way attribution is usually wrong:
 *
 * 1. **It names its basis.** The figures are money-weighted, and the panel says so — a reader who
 *    assumed time-weighted would be comparing it against the wrong number on the review page.
 * 2. **It shows the residual.** When the parts do not sum to the whole, the gap is displayed with
 *    the reason, rather than the parts being scaled until it disappears.
 * 3. **It never advises.** "TSLA removed 1.4 percentage points" is a fact about a period that has
 *    happened. `attribution.test.ts` holds these sentences to the insights engine's forbidden
 *    vocabulary.
 */
export function AttributionPanel({
  attribution,
  residual,
  contributors,
  detractors,
  currency,
}: {
  attribution: AttributionResult
  residual: number | null
  contributors: Contribution[]
  detractors: Contribution[]
  currency: Currency
}) {
  if (!attribution.ok) {
    return (
      <Section title="What produced this return" description="Money-weighted attribution">
        <p className="text-muted-foreground text-sm">{UNAVAILABLE_REASONS[attribution.reason]}</p>
      </Section>
    )
  }

  return (
    <Section
      title="What produced this return"
      description="Money-weighted: each holding measured against the money actually in it."
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric
          label="Total gain"
          value={<Delta value={attribution.totalGain} currency={currency} />}
          hint={<Percent value={attribution.totalReturnPct} />}
        />
        <Metric
          label="From price"
          value={<Delta value={attribution.priceGain} currency={currency} />}
          hint={formatOptionalPercent(attribution.pricePct)}
        />
        <Metric
          label="From dividends"
          value={<Delta value={attribution.dividendGain} currency={currency} />}
          hint={formatOptionalPercent(attribution.dividendPct)}
        />
        <Metric
          label="From currency"
          value={<span className="text-muted-foreground">N/A</span>}
          hint="Needs historical rates"
        />
      </dl>

      <p className="text-muted-foreground mt-3 text-xs">{attribution.fxUnavailableReason}</p>

      {/*
        External money, stated separately and never folded into the gain. A portfolio that grew
        because it was fed did not perform.
      */}
      {attribution.netFlow !== 0 && (
        <p className="text-muted-foreground mt-2 text-xs">
          {formatCurrency(Math.abs(attribution.netFlow), currency)} was{" "}
          {attribution.netFlow > 0 ? "paid into" : "withdrawn from"} the portfolio during this period
          and is excluded from every figure above.
        </p>
      )}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <ContributionList title="Added most" rows={contributors} currency={currency} />
        <ContributionList title="Removed most" rows={detractors} currency={currency} />
      </div>

      {residual !== null && Math.abs(residual) > 0.01 && (
        <p className="text-muted-foreground mt-4 border-t pt-3 text-xs">
          {formatCurrency(Math.abs(residual), currency)} of the total is not attributed to a
          holding
          {attribution.incompleteSymbols.length > 0
            ? `: ${attribution.incompleteSymbols.join(", ")} could not be valued for this period.`
            : "."}
        </p>
      )}
    </Section>
  )
}

function ContributionList({
  title,
  rows,
  currency,
}: {
  title: string
  rows: Contribution[]
  currency: Currency
}) {
  return (
    <div className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing in this period.</p>
      ) : (
        <ul className="divide-y">
          {rows.map((row) => (
            <li key={`${row.market}:${row.symbol}`} className="py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium">{row.symbol}</span>
                <span className="tabular text-sm">
                  <Percent value={row.contributionPct} />
                </span>
              </div>
              {/*
                The holding's own return beside its contribution, because they are different
                numbers and the difference is the point: a position up 40% that was 2% of the
                portfolio contributed under a point.
              */}
              <p className="text-muted-foreground text-xs">
                {describeContribution(row, currency)}
                {row.holdingReturnPct !== null
                  ? ` Its own return was ${row.holdingReturnPct.toFixed(1)}%.`
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
