"use client"

import { useMemo, useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Metric } from "@/components/metric"
import {
  PROJECTION_SCENARIOS,
  SCENARIO_GROWTH,
  projectGoal,
  type ProjectionScenario,
} from "@/domain/goals"
import type { Currency } from "@/domain/market"
import { formatCurrency, formatDate } from "@/lib/format"

const SCENARIO_LABELS: Record<ProjectionScenario, string> = {
  CONSERVATIVE: "Conservative",
  BASE: "Base",
  OPTIMISTIC: "Optimistic",
}

/**
 * Scenario modelling for a goal.
 *
 * Computed in the browser from `domain/goals.ts`, because it is arithmetic on numbers already on
 * the page — a round trip would add latency and a second place for the assumptions to live.
 *
 * Every assumption is an input the user can see and change, and the result never claims a date will
 * happen. "Under this assumption the modelled value reaches the target around…" is the strongest
 * sentence here, deliberately.
 */
export function ProjectionPanel({
  startValue,
  target,
  currency,
  suggestedContribution,
}: {
  startValue: number
  /** Null models growth with no target line. */
  target: number | null
  currency: Currency
  /** The user's own average monthly net contribution, when there is enough history for one. */
  suggestedContribution: number | null
}) {
  const [scenario, setScenario] = useState<ProjectionScenario>("BASE")
  const [growthPct, setGrowthPct] = useState(String(SCENARIO_GROWTH.BASE * 100))
  const [contribution, setContribution] = useState(
    String(Math.max(0, Math.round(suggestedContribution ?? 0))),
  )
  const [horizon, setHorizon] = useState("10")

  const projection = useMemo(() => {
    const annualGrowth = Number(growthPct) / 100
    return projectGoal(
      startValue,
      target,
      {
        scenario,
        annualGrowth: Number.isFinite(annualGrowth) ? annualGrowth : SCENARIO_GROWTH[scenario],
        monthlyContribution: Math.max(0, Number(contribution) || 0),
        horizonYears: Math.min(50, Math.max(1, Number(horizon) || 10)),
      },
      currency,
    )
  }, [startValue, target, scenario, growthPct, contribution, horizon, currency])

  const final = projection?.points.at(-1)

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="projection-scenario">Scenario</Label>
          <Select
            value={scenario}
            onValueChange={(value) => {
              const next = (value as ProjectionScenario) ?? "BASE"
              setScenario(next)
              setGrowthPct(String(SCENARIO_GROWTH[next] * 100))
            }}
          >
            <SelectTrigger id="projection-scenario" className="w-full">
              <SelectValue>{(value) => SCENARIO_LABELS[value as ProjectionScenario]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PROJECTION_SCENARIOS.map((option) => (
                <SelectItem key={option} value={option}>
                  {SCENARIO_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="projection-growth">Annual growth (%)</Label>
          <Input
            id="projection-growth"
            type="number"
            inputMode="decimal"
            step="any"
            className="tabular"
            value={growthPct}
            onChange={(event) => setGrowthPct(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="projection-contribution">Monthly ({currency})</Label>
          <Input
            id="projection-contribution"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            className="tabular"
            value={contribution}
            onChange={(event) => setContribution(event.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="projection-horizon">Years</Label>
          <Input
            id="projection-horizon"
            type="number"
            inputMode="numeric"
            min={1}
            max={50}
            className="tabular"
            value={horizon}
            onChange={(event) => setHorizon(event.target.value)}
          />
        </div>
      </div>

      {suggestedContribution !== null && (
        <p className="text-muted-foreground text-xs">
          Your own average over the last twelve months is{" "}
          {formatCurrency(suggestedContribution, currency)} a month.
        </p>
      )}

      {projection === null || final === undefined ? (
        <p className="text-muted-foreground text-sm">
          N/A — those assumptions cannot be modelled. Check the growth rate and horizon.
        </p>
      ) : (
        <>
          <dl className="grid gap-4 sm:grid-cols-3">
            <Metric
              label="Starting value"
              value={formatCurrency(projection.startValue, currency)}
              hint="Today, from your portfolio"
            />
            <Metric
              label={`Modelled value in ${horizon} years`}
              value={formatCurrency(final.value, currency)}
              hint={`Of which ${formatCurrency(projection.totalContributions, currency)} is money you would pay in`}
            />
            <Metric
              label="Target reached"
              value={
                target === null ? (
                  <span className="text-muted-foreground">No target set</span>
                ) : projection.reachesTargetOn ? (
                  formatDate(projection.reachesTargetOn)
                ) : (
                  <span className="text-muted-foreground">Not within {horizon} years</span>
                )
              }
              hint={
                projection.reachesTargetOn
                  ? "The month the model crosses the target under this assumption"
                  : undefined
              }
            />
          </dl>

          <p className="text-muted-foreground border-t pt-3 text-xs">
            <strong className="font-medium">This is a model, not a forecast.</strong>{" "}
            {projection.method} Growth of {growthPct}% a year is an assumption you chose, not
            Stockly&apos;s view and not your portfolio&apos;s history. Markets do not return a fixed
            amount each year, past returns do not determine future ones, and none of this is
            investment advice.
          </p>
        </>
      )}
    </div>
  )
}
