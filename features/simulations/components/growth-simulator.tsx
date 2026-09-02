"use client"

import { useEffect, useMemo } from "react"
import { Metric, Section } from "@/components/metric"
import { StatCard, StatGrid } from "@/components/stat-card"
import type { Currency } from "@/domain/market"
import {
  FREQUENCY_LABELS,
  SCENARIO_LABELS,
  SCENARIOS,
  SCENARIO_RETURNS,
  compareReturns,
  realReturn,
  simulateGrowth,
} from "@/domain/simulation"
import { formatCurrency, formatCurrencyWithCode, formatPercent } from "@/lib/format"
import { AssumptionPanel, DataLabel } from "./assumptions"
import { GrowthAreaChart, ScenarioComparisonChart } from "./lazy-charts"
import { FrequencyField, NumberField, ScenarioPicker } from "./inputs"
import {
  REASON_TEXT,
  num,
  optionalNum,
  toScenario,
  useScenarioState,
  type ScenarioState,
} from "./use-scenario"

/**
 * Compound growth and regular investing — one simulator, because they are one calculation.
 *
 * Everything runs in the browser: the engine is pure, so a slider moves and the numbers move with
 * it, with no round trip and no debounce to tune. `useMemo` keeps it off the render path when
 * nothing changed.
 */
export function GrowthSimulator({
  currency,
  startingValue,
  suggestedContribution,
  initialState,
  onStateChange,
}: {
  currency: Currency
  /** The portfolio's value today, offered as a starting point. */
  startingValue: number | null
  /** The user's own average monthly contribution, when there is history to average. */
  suggestedContribution: number | null
  /** Restores a saved scenario. The parent remounts on load rather than syncing state both ways. */
  initialState?: Partial<ScenarioState>
  /** Reports the inputs upward so the parent can offer to save them. */
  onStateChange?: (state: ScenarioState) => void
}) {
  const { state, set, pickScenario } = useScenarioState({
    initialValue: String(Math.max(0, Math.round(startingValue ?? 0))),
    contribution: String(Math.max(0, Math.round(suggestedContribution ?? 10_000))),
    ...initialState,
  })

  // Reported on every change so the Save button always writes what is on screen. An effect rather
  // than a call inside the setters: there is one place state settles, and this is downstream of it.
  useEffect(() => {
    onStateChange?.(state)
  }, [state, onStateChange])

  const scenario = useMemo(() => toScenario(state, currency), [state, currency])
  const result = useMemo(() => simulateGrowth(scenario), [scenario])
  const comparison = useMemo(
    () => compareReturns(scenario, SCENARIOS.map((name) => SCENARIO_RETURNS[name])),
    [scenario],
  )

  const inflation = optionalNum(state.inflationPct)
  const real = realReturn(num(state.annualReturnPct) / 100, inflation === null ? null : inflation / 100)

  return (
    <div className="space-y-6">
      <Section title="Scenario inputs" description="Change anything; the numbers follow immediately.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField
            id="growth-initial"
            label="Starting value"
            suffix={currency}
            value={state.initialValue}
            onChange={set("initialValue")}
            min={0}
            hint={
              startingValue !== null
                ? `Your portfolio is ${formatCurrency(startingValue, currency)}`
                : undefined
            }
          />
          <NumberField
            id="growth-contribution"
            label="Contribution"
            suffix={currency}
            value={state.contribution}
            onChange={set("contribution")}
            min={0}
            hint={
              suggestedContribution !== null
                ? `Your own average is ${formatCurrency(suggestedContribution, currency)}`
                : undefined
            }
          />
          <FrequencyField value={state.frequency} onChange={set("frequency")} />
          <NumberField
            id="growth-years"
            label="Duration"
            suffix="years"
            value={state.years}
            onChange={set("years")}
            min={1}
            max={50}
          />
          <ScenarioPicker value={state.scenario} onChange={pickScenario} />
          <NumberField
            id="growth-return"
            label="Annual return"
            suffix="%"
            value={state.annualReturnPct}
            onChange={set("annualReturnPct")}
          />
          <NumberField
            id="growth-escalation"
            label="Contribution increase"
            suffix="% a year"
            value={state.contributionGrowthPct}
            onChange={set("contributionGrowthPct")}
            hint="Applied once a year, not every period."
          />
          <NumberField
            id="growth-inflation"
            label="Inflation"
            suffix="%"
            value={state.inflationPct}
            onChange={set("inflationPct")}
            hint="Leave blank to skip real values entirely."
          />
        </div>
      </Section>

      {!result.ok ? (
        <p className="text-muted-foreground text-sm">
          N/A — {REASON_TEXT[result.reason] ?? "that scenario cannot be modelled."}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">Scenario result</h2>
            <DataLabel kind="PROJECTED" />
          </div>

          <StatGrid>
            <StatCard
              label="Scenario value"
              value={formatCurrencyWithCode(result.value.finalValue, currency)}
              emphasis
              hint={
                <span className="text-muted-foreground">
                  after {state.years} year{num(state.years) === 1 ? "" : "s"}
                </span>
              }
            />
            <StatCard
              label="Paid in"
              value={formatCurrency(result.value.totalInvested, currency)}
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {formatCurrency(result.value.totalContributions, currency)} in contributions
                </span>
              }
            />
            <StatCard
              label="Scenario growth"
              value={formatCurrency(result.value.totalGrowth, currency)}
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {result.value.growthPct === null
                    ? "N/A"
                    : `${formatPercent(result.value.growthPct)} of what was paid in`}
                </span>
              }
            />
            <StatCard
              label="In today's money"
              value={
                result.value.finalRealValue === null ? (
                  <span className="text-muted-foreground text-lg">N/A</span>
                ) : (
                  formatCurrency(result.value.finalRealValue, currency)
                )
              }
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {real === null
                    ? "Add an inflation assumption"
                    : `${formatPercent(real * 100)} real return`}
                </span>
              }
            />
          </StatGrid>

          <Section
            title="Paid in against growth"
            description="Stacked, so the part that is your money and the part that is the assumed return stay distinguishable."
          >
            <GrowthAreaChart points={result.value.points} currency={currency} />
          </Section>

          <Section
            title="The same plan at three rates"
            description="One assumption changed, everything else held."
          >
            <ScenarioComparisonChart
              rows={SCENARIOS.map((name, index) => ({
                label: `${SCENARIO_LABELS[name]} · ${(SCENARIO_RETURNS[name] * 100).toFixed(0)}%`,
                value: comparison[index].result.ok ? comparison[index].result.value.finalValue : null,
              }))}
              currency={currency}
            />
            <dl className="mt-4 grid gap-4 sm:grid-cols-3">
              {SCENARIOS.map((name, index) => {
                const row = comparison[index].result
                return (
                  <Metric
                    key={name}
                    label={`${SCENARIO_LABELS[name]} · ${(SCENARIO_RETURNS[name] * 100).toFixed(0)}%`}
                    value={
                      row.ok ? formatCurrency(row.value.finalValue, currency) : <span>N/A</span>
                    }
                    hint={row.ok ? formatCurrency(row.value.totalGrowth, currency) + " growth" : undefined}
                  />
                )
              })}
            </dl>
          </Section>

          <AssumptionPanel
            method={result.value.method}
            assumptions={[
              { label: "Starting value", value: formatCurrency(scenario.initialValue, currency) },
              {
                label: "Contribution",
                value: formatCurrency(scenario.contribution, currency),
                hint: FREQUENCY_LABELS[scenario.frequency].toLowerCase() + ", at period end",
              },
              { label: "Annual return", value: formatPercent(scenario.annualReturn * 100) },
              { label: "Duration", value: `${scenario.years} years` },
              {
                label: "Contribution increase",
                value: formatPercent(scenario.contributionGrowth * 100),
                hint: "once a year",
              },
              {
                label: "Inflation",
                value:
                  scenario.inflationRate === null
                    ? "Not modelled"
                    : formatPercent(scenario.inflationRate * 100),
              },
              { label: "Currency", value: currency },
            ]}
          />
        </>
      )}
    </div>
  )
}
