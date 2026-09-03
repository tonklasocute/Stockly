import { Metric, Section } from "@/components/metric"
import { Delta, Percent } from "@/components/value"
import { describeContribution, type AttributionResult, type Contribution } from "@/domain/attribution"
import { getTranslations } from "next-intl/server"
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
export async function AttributionPanel({
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
  const t = await getTranslations("analytics")

  if (!attribution.ok) {
    return (
      <Section title={t("attribution.title")} description={t("attribution.method")}>
        <p className="text-muted-foreground text-sm">
          {t(`attribution.unavailable.${attribution.reason}`)}
        </p>
      </Section>
    )
  }

  return (
    <Section
      title={t("attribution.title")}
      description={t("attribution.methodHint")}
    >
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric
          label={t("attribution.totalGain")}
          value={<Delta value={attribution.totalGain} currency={currency} />}
          hint={<Percent value={attribution.totalReturnPct} />}
        />
        <Metric
          label={t("attribution.fromPrice")}
          value={<Delta value={attribution.priceGain} currency={currency} />}
          hint={formatOptionalPercent(attribution.pricePct)}
        />
        <Metric
          label={t("attribution.fromDividends")}
          value={<Delta value={attribution.dividendGain} currency={currency} />}
          hint={formatOptionalPercent(attribution.dividendPct)}
        />
        <Metric
          label={t("attribution.fromCurrency")}
          value={<span className="text-muted-foreground">N/A</span>}
          hint={t("attribution.needsHistoricalRates")}
        />
      </dl>

      <p className="text-muted-foreground mt-3 text-xs">{t(`attribution.unavailable.${attribution.fxUnavailableCode}`)}</p>

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
        <ContributionList title={t("attribution.addedMost")} rows={contributors} currency={currency} />
        <ContributionList title={t("attribution.removedMost")} rows={detractors} currency={currency} />
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

async function ContributionList({
  title,
  rows,
  currency,
}: {
  title: string
  rows: Contribution[]
  currency: Currency
}) {
  const t = await getTranslations("analytics")

  return (
    <div className="space-y-2">
      <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("attribution.empty")}</p>
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
                {sentenceFor(describeContribution(row, currency), t)}
                {row.holdingReturnPct !== null
                  ? t("attribution.ownReturn", { pct: row.holdingReturnPct.toFixed(1) })
                  : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * The facts become a sentence here, and only here.
 *
 * `describeContribution` reports what a holding did; the ICU message decides how to say it. That
 * split is why Thai reads as Thai rather than as an English skeleton with Thai words dropped into
 * it, and why the forbidden-vocabulary test can be run against both languages.
 */
function sentenceFor(
  facts: ReturnType<typeof describeContribution>,
  t: Awaited<ReturnType<typeof getTranslations<"analytics">>>,
): string {
  return facts.incomplete
    ? t("attribution.contribution.incomplete", { symbol: facts.symbol })
    : t(`attribution.contribution.${facts.direction}`, {
        symbol: facts.symbol,
        points: facts.points,
        amount: facts.amount,
        currency: facts.currency,
      })
}
