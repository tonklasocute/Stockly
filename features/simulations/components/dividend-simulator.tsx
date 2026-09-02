"use client"

import { useMemo, useState } from "react"
import { Metric, Section } from "@/components/metric"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { Currency } from "@/domain/market"
import { FREQUENCY_LABELS, projectDividends } from "@/domain/simulation"
import { formatCurrency, formatCurrencyWithCode, formatPercent } from "@/lib/format"
import { AssumptionPanel, DataLabel } from "./assumptions"
import { DividendProjectionChart } from "./lazy-charts"
import { FrequencyField, NumberField, ScenarioPicker } from "./inputs"
import { REASON_TEXT, num, optionalNum, toScenario, useScenarioState } from "./use-scenario"

/**
 * Dividend projection.
 *
 * The distinction this panel is built around: **actual income and projected income are different
 * data.** What the portfolio paid over the last twelve months sits in its own card, labelled
 * ACTUAL, and is never added to a projected figure or charted beside one.
 *
 * Both yields are named in full. Yield on cost and yield on current value share a numerator and
 * nothing else, and calling either one "dividend yield" is how a 3% portfolio appears to yield 9%.
 */
export function DividendSimulator({
  currency,
  portfolioValue,
  actualTrailingIncome,
  impliedYieldPct,
  costBasis,
  suggestedContribution,
}: {
  currency: Currency
  portfolioValue: number
  /** What the portfolio actually paid over the last twelve months. Never projected. */
  actualTrailingIncome: number
  /** Derived from the portfolio's own income. Null when there is none to derive it from. */
  impliedYieldPct: number | null
  costBasis: number | null
  suggestedContribution: number | null
}) {
  const { state, set, pickScenario } = useScenarioState({
    initialValue: String(Math.max(0, Math.round(portfolioValue))),
    contribution: String(Math.max(0, Math.round(suggestedContribution ?? 0))),
    years: "10",
  })
  const [yieldPct, setYieldPct] = useState(
    impliedYieldPct === null ? "" : impliedYieldPct.toFixed(2),
  )
  const [yieldGrowthPct, setYieldGrowthPct] = useState("0")
  const [reinvest, setReinvest] = useState(false)

  const growth = useMemo(() => toScenario(state, currency), [state, currency])
  const assumedYield = optionalNum(yieldPct)

  const projection = useMemo(
    () =>
      projectDividends({
        ...growth,
        // Null rather than 0: a portfolio with no dividend history has an unknown future income,
        // and ฿0 a year would be a claim rather than an absence.
        annualYield: assumedYield === null ? null : assumedYield / 100,
        yieldGrowth: num(yieldGrowthPct) / 100,
        reinvest,
        costBasis,
      }),
    [growth, assumedYield, yieldGrowthPct, reinvest, costBasis],
  )

  return (
    <div className="space-y-6">
      <Section
        title="What the portfolio actually pays"
        description="Recorded payments, net of tax and fees. Nothing on this row is projected."
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <Metric
            label="Last twelve months"
            value={
              <span className="flex items-center gap-2">
                {formatCurrency(actualTrailingIncome, currency)}
                <DataLabel kind="ACTUAL" />
              </span>
            }
            hint="From your dividend records"
          />
          <Metric
            label="Yield on current value"
            value={
              impliedYieldPct === null
                ? "N/A"
                : formatPercent(impliedYieldPct, { signed: false })
            }
            hint="Trailing income ÷ portfolio value"
          />
          <Metric
            label="Yield on cost"
            value={
              costBasis && costBasis > 0
                ? formatPercent((actualTrailingIncome / costBasis) * 100, { signed: false })
                : "N/A"
            }
            hint="Trailing income ÷ what you paid"
          />
        </dl>
      </Section>

      <Section title="Scenario inputs" description="Assumptions you choose, applied to the future.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            id="dividend-initial"
            label="Starting value"
            suffix={currency}
            value={state.initialValue}
            onChange={set("initialValue")}
            min={0}
          />
          <NumberField
            id="dividend-contribution"
            label="Contribution"
            suffix={currency}
            value={state.contribution}
            onChange={set("contribution")}
            min={0}
          />
          <FrequencyField value={state.frequency} onChange={set("frequency")} />
          <NumberField
            id="dividend-years"
            label="Duration"
            suffix="years"
            value={state.years}
            onChange={set("years")}
            min={1}
            max={50}
          />
          <ScenarioPicker value={state.scenario} onChange={pickScenario} />
          <NumberField
            id="dividend-return"
            label="Annual price return"
            suffix="%"
            value={state.annualReturnPct}
            onChange={set("annualReturnPct")}
            hint="Excludes dividends, which are modelled separately."
          />
          <NumberField
            id="dividend-yield"
            label="Assumed yield"
            suffix="%"
            value={yieldPct}
            onChange={setYieldPct}
            min={0}
            hint={
              impliedYieldPct === null
                ? "Your portfolio has no dividend history to base one on."
                : `Your own trailing yield is ${impliedYieldPct.toFixed(2)}%`
            }
          />
          <NumberField
            id="dividend-yield-growth"
            label="Yield growth"
            suffix="% a year"
            value={yieldGrowthPct}
            onChange={setYieldGrowthPct}
          />
          <div className="space-y-2">
            <Label htmlFor="dividend-reinvest">Reinvest dividends</Label>
            <Select
              value={reinvest ? "yes" : "no"}
              onValueChange={(value) => setReinvest(value === "yes")}
            >
              <SelectTrigger id="dividend-reinvest" className="w-full">
                <SelectValue>{(value) => (value === "yes" ? "Yes" : "No")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="no">No — take the income</SelectItem>
                <SelectItem value="yes">Yes — reinvest it</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <NumberField
            id="dividend-inflation"
            label="Inflation"
            suffix="%"
            value={state.inflationPct}
            onChange={set("inflationPct")}
            hint="Leave blank to skip real values."
          />
        </div>
      </Section>

      {!projection.ok ? (
        <p className="text-muted-foreground text-sm">
          N/A —{" "}
          {projection.reason === "INSUFFICIENT_HISTORY"
            ? "enter an assumed yield. Stockly will not guess one for a portfolio with no dividend history."
            : (REASON_TEXT[projection.reason] ?? "that scenario cannot be modelled.")}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Projected income</h2>
            <DataLabel kind="PROJECTED" />
          </div>

          <StatGrid>
            <StatCard
              label={`Income in year ${projection.value.years.length}`}
              value={formatCurrencyWithCode(projection.value.finalAnnualIncome, currency)}
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {projection.value.incomeGrowthPct === null
                    ? "N/A"
                    : `${formatPercent(projection.value.incomeGrowthPct)} against year 1`}
                </span>
              }
            />
            <StatCard
              label="Cumulative income"
              value={formatCurrency(projection.value.cumulativeIncome, currency)}
              emphasis
              hint={
                <span className="text-muted-foreground">
                  over {projection.value.years.length} years
                </span>
              }
            />
            <StatCard
              label="Yield on current value"
              value={
                projection.value.years.at(-1)?.yieldOnValuePct === null ||
                projection.value.years.at(-1)?.yieldOnValuePct === undefined ? (
                  <span className="text-muted-foreground text-lg">N/A</span>
                ) : (
                  formatPercent(projection.value.years.at(-1)!.yieldOnValuePct!, { signed: false })
                )
              }
              emphasis
              hint={<span className="text-muted-foreground">in the final modelled year</span>}
            />
            <StatCard
              label="Yield on cost"
              value={
                projection.value.years.at(-1)?.yieldOnCostPct == null ? (
                  <span className="text-muted-foreground text-lg">N/A</span>
                ) : (
                  formatPercent(projection.value.years.at(-1)!.yieldOnCostPct!, { signed: false })
                )
              }
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {costBasis === null ? "No cost basis recorded" : "against today's cost basis"}
                </span>
              }
            />
          </StatGrid>

          <Section title="Income by year" description="Projected, under the assumptions below.">
            <DividendProjectionChart years={projection.value.years} currency={currency} />
          </Section>

          <AssumptionPanel
            method={projection.value.method}
            assumptions={[
              { label: "Starting value", value: formatCurrency(growth.initialValue, currency) },
              {
                label: "Contribution",
                value: formatCurrency(growth.contribution, currency),
                hint: FREQUENCY_LABELS[growth.frequency].toLowerCase() + ", at period end",
              },
              { label: "Annual price return", value: formatPercent(growth.annualReturn * 100) },
              {
                label: "Assumed yield",
                value: assumedYield === null ? "N/A" : formatPercent(assumedYield, { signed: false }),
                hint: impliedYieldPct === null ? "your figure" : "from your own trailing income",
              },
              { label: "Yield growth", value: formatPercent(num(yieldGrowthPct)) },
              { label: "Reinvestment", value: reinvest ? "On" : "Off" },
              { label: "Duration", value: `${growth.years} years` },
              { label: "Currency", value: currency },
            ]}
          />
        </>
      )}
    </div>
  )
}
