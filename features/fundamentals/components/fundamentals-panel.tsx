import { Metric, Section } from "@/components/metric"
import { Badge } from "@/components/ui/badge"
import { Percent } from "@/components/value"
import {
  FUNDAMENTALS_DISCLAIMER,
  METRIC_DEFINITIONS,
  type FundamentalMetrics,
} from "@/domain/fundamentals"
import { VALUATION_DISCLAIMER } from "@/domain/valuation"
import { describeEvent } from "@/domain/corporate-events"
import { eventSentence } from "../event-sentence"
import type { FundamentalBundle } from "@/features/fundamentals/loader"
import { formatCompact, formatDate } from "@/lib/format"
import { appLocale } from "@/lib/i18n/server"
import { getTranslations } from "next-intl/server"

/**
 * The fundamentals section of an instrument page.
 *
 * Three things it is careful about:
 *
 * 1. **N/A always says which kind.** "Not configured", "this company does not report it" and "the
 *    provider failed" are three different sentences, and a single blank cell for all three would
 *    make a coverage gap look like a fact about the business.
 * 2. **Every multiple carries its period.** "P/E (TTM)" and "P/E (FY2025)" are different numbers;
 *    a bare "P/E" is the thing readers misinterpret.
 * 3. **Every metric can be checked.** The formula and required inputs are on the tile, so a figure
 *    is never something to take on faith.
 */
export async function FundamentalsPanel({ data }: { data: FundamentalBundle }) {
  const tEnum = await getTranslations("enums")
  const tf = await getTranslations("fundamentals")
  const locale = await appLocale()
  /*
   * The currency the COMPANY reports in — not the market's and not the portfolio's.
   *
   * Every money figure below carries it. Phase 17.5 found them rendered bare (CUR-001), which put a
   * ฿12B revenue and a $12B revenue on screen as the same "12.0B": a thirty-two-fold error in the
   * reader's head, and exactly what the multi-currency rule exists to prevent.
   */
  const reportingCurrency =
    data.ttm?.currency ?? data.annual[0]?.currency ?? data.quarterly[0]?.currency ?? null
  if (!data.covered || data.unavailableReason !== null) {
    return (
      <Section title={tf("title")}>
        <p className="text-muted-foreground text-sm">{data.unavailableReason}</p>
        {!data.covered && (
          <p className="text-muted-foreground mt-2 text-xs">{tf("notConfigured")}</p>
        )}
      </Section>
    )
  }

  const { metrics, valuation, growth } = data

  return (
    <div className="space-y-4">
      <Section
        title={tf("title")}
        description={data.metricsPeriodLabel ? `Latest period: ${data.metricsPeriodLabel}` : undefined}
        action={
          data.freshness === "STALE" ? (
            <Badge variant="secondary">{tf("outdated")}</Badge>
          ) : null
        }
      >
        {metrics ? (
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(
              [
                "grossMargin",
                "operatingMargin",
                "netMargin",
                "returnOnEquity",
                "returnOnAssets",
                "fcfMargin",
                "debtToEquity",
                "currentRatio",
              ] as (keyof FundamentalMetrics)[]
            ).map((key) => (
              <Metric
                key={key}
                label={METRIC_DEFINITIONS[key].label}
                value={renderMetric(metrics[key], METRIC_DEFINITIONS[key].unit, reportingCurrency)}
                // The formula, on the tile. A figure a reader cannot check is one they have to
                // take on faith, and this codebase does not ask for faith.
                hint={
                  <span className="text-muted-foreground text-xs">
                    {metrics[key] === null
                      ? `Needs ${METRIC_DEFINITIONS[key].requires.toLowerCase()}`
                      : METRIC_DEFINITIONS[key].formula}
                  </span>
                }
              />
            ))}
          </dl>
        ) : (
          <p className="text-muted-foreground text-sm">{tf("noStatements")}</p>
        )}
      </Section>

      {growth && (
        <Section title={tf("growth")} description={`${growth.from} to ${growth.to}, year on year`}>
          {growth.unavailableReason ? (
            <p className="text-muted-foreground text-sm">{growth.unavailableReason}</p>
          ) : (
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label={tf("revenue")} value={renderPercent(growth.revenueGrowth)} />
              <Metric label={tf("operatingIncome")} value={renderPercent(growth.operatingIncomeGrowth)} />
              <Metric label={tf("netIncome")} value={renderPercent(growth.netIncomeGrowth)} />
              <Metric label={tf("freeCashFlow")} value={renderPercent(growth.fcfGrowth)} />
            </dl>
          )}
          <p className="text-muted-foreground mt-3 text-xs">
            Growth from a loss is shown as N/A: a percentage change from a negative base is not
            defined in a way that reads correctly.
          </p>
        </Section>
      )}

      {valuation && (
        <Section
          title={tf("valuation")}
          description={valuation.periodLabel ? `Measured against ${valuation.periodLabel}` : undefined}
        >
          {valuation.unavailableReason ? (
            <p className="text-muted-foreground text-sm">{valuation.unavailableReason}</p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Metric
                  label={`P/E (${valuation.periodLabel})`}
                  value={renderRatio(valuation.priceToEarnings)}
                  hint={valuation.priceToEarnings === null ? "No positive earnings" : undefined}
                />
                <Metric label={`P/S (${valuation.periodLabel})`} value={renderRatio(valuation.priceToSales)} />
                <Metric label={tf("pb")} value={renderRatio(valuation.priceToBook)} />
                <Metric label={tf("evEbitda")} value={renderRatio(valuation.evToEbitda)} />
                <Metric label={tf("earningsYield")} value={renderPercent(valuation.earningsYield)} />
                <Metric label={tf("fcfYield")} value={renderPercent(valuation.freeCashFlowYield)} />
                <Metric label={tf("dividendYield")} value={renderPercent(valuation.dividendYield)} />
                <Metric
                  label={tf("marketCap")}
                  value={
                    valuation.marketCap === null
                      ? "N/A"
                      : formatCompact(valuation.marketCap, reportingCurrency ?? undefined)
                  }
                />
              </dl>
              <p className="text-muted-foreground mt-3 text-xs">{VALUATION_DISCLAIMER}</p>
            </>
          )}
        </Section>
      )}

      {data.events.length > 0 && (
        <Section title={tf("eventsSection")} description={tf("eventsHint")}>
          <ul className="divide-y">
            {data.events.slice(0, 8).map((event, index) => (
              <li key={`${event.type}-${event.date ?? index}`} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span>{eventSentence(describeEvent(event), tf, tEnum(`corporateEvent.${event.type}`))}</span>
                <span className="flex items-center gap-2">
                  {/* An estimated date is labelled every time it appears. */}
                  {event.estimated && <Badge variant="secondary">{tf("estimated")}</Badge>}
                  <span className="text-muted-foreground text-xs">{tEnum(`corporateEvent.${event.type}`)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="text-muted-foreground text-xs">
        {FUNDAMENTALS_DISCLAIMER}
        {reportingCurrency && ` Figures are as reported by the company, in ${reportingCurrency}.`}
        {data.fetchedAt && ` Source: ${data.providerName}. Fetched ${formatDate(data.fetchedAt, locale)}.`}
      </p>
    </div>
  )
}

/** N/A rather than 0 for every unavailable figure, without exception. */
function renderMetric(
  value: number | null,
  unit: "percent" | "ratio" | "money",
  currency: string | null,
): React.ReactNode {
  if (value === null) return <span className="text-muted-foreground">N/A</span>
  if (unit === "percent") return <Percent value={value} />
  // A money figure always names its unit. Free cash flow and net debt are the two here, and both
  // are read beside figures from companies reporting in another currency.
  if (unit === "money") return formatCompact(value, currency ?? undefined)
  return value.toFixed(2)
}

function renderPercent(value: number | null): React.ReactNode {
  return value === null ? <span className="text-muted-foreground">N/A</span> : <Percent value={value} />
}

function renderRatio(value: number | null): React.ReactNode {
  return value === null ? <span className="text-muted-foreground">N/A</span> : value.toFixed(1)
}
