"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Section } from "@/components/metric"
import { StatCard, StatGrid } from "@/components/stat-card"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { GOAL_DEFINITIONS, type GoalType } from "@/domain/goals"
import type { Currency } from "@/domain/market"
import {
  planGoal,
  requiredContribution,
  scenarioMatrix,
  yearsUntil,
} from "@/domain/simulation"
import { formatCurrency, formatCurrencyWithCode, formatDate, formatPercent } from "@/lib/format"
import { AssumptionPanel, DataLabel } from "./assumptions"
import { GrowthAreaChart } from "./lazy-charts"
import { FrequencyField, NumberField, ScenarioPicker } from "./inputs"
import { toScenario, useScenarioState } from "./use-scenario"
import { useAppLocale } from "@/lib/i18n/locale"
import { useTranslations } from "next-intl"

/** A goal the user has already set, with the figures it is measured against. */
export type PlannableGoal = {
  id: string
  type: GoalType
  label: string
  currentValue: number
  targetValue: number
  targetDate: string | null
  unit: "money" | "percent"
}

/**
 * Goal planning: where a scenario lands against a target, and what it would take to close the gap.
 *
 * Every figure here is *projected*, and the vocabulary keeps saying so. The gap is a **projected
 * gap** — what this arithmetic produces under this assumption — never a shortfall anyone is heading
 * for, and the required contribution is what the formula asks for, not a recommendation.
 */
export function GoalSimulator({
  currency,
  goals,
  suggestedContribution,
  portfolioId,
}: {
  currency: Currency
  goals: PlannableGoal[]
  suggestedContribution: number | null
  portfolioId: string
}) {
  const t = useTranslations("simulations")
  const tEnum = useTranslations("enums")
  const locale = useAppLocale()
  const [selectedId, setSelectedId] = useState(goals[0]?.id ?? "")
  const goal = goals.find((g) => g.id === selectedId) ?? goals[0] ?? null

  const defaultYears = goal ? (yearsUntil(goal.targetDate, new Date()) ?? 10) : 10
  const { state, set, pickScenario, setState } = useScenarioState({
    initialValue: String(Math.max(0, Math.round(goal?.currentValue ?? 0))),
    contribution: String(Math.max(0, Math.round(suggestedContribution ?? 10_000))),
    years: String(Math.max(1, Math.round(defaultYears))),
  })

  const scenario = useMemo(() => toScenario(state, currency), [state, currency])
  const targetValue = goal?.targetValue ?? 0

  const planInput = useMemo(
    () => ({
      currentValue: scenario.initialValue,
      targetValue,
      contribution: scenario.contribution,
      frequency: scenario.frequency,
      timing: scenario.timing,
      annualReturn: scenario.annualReturn,
      years: scenario.years,
      contributionGrowth: scenario.contributionGrowth,
      inflationRate: scenario.inflationRate,
      currency,
    }),
    [scenario, targetValue, currency],
  )

  const plan = useMemo(() => planGoal(planInput), [planInput])
  const required = useMemo(
    () =>
      requiredContribution({
        currentValue: planInput.currentValue,
        targetValue: planInput.targetValue,
        annualReturn: planInput.annualReturn,
        years: planInput.years,
        frequency: planInput.frequency,
        timing: planInput.timing,
      }),
    [planInput],
  )
  const matrix = useMemo(() => scenarioMatrix(planInput), [planInput])

  if (!goal) {
    return (
      <div className="space-y-3 rounded-xl border p-6 text-center">
        <p className="text-muted-foreground text-sm">{t("goal.noGoals")}</p>
        <Button nativeButton={false} render={<Link href={`/goals?p=${portfolioId}`} />} size="sm">{t("goal.setGoal")}</Button>
      </div>
    )
  }

  const money = (value: number) =>
    goal.unit === "percent" ? formatPercent(value, { signed: false }) : formatCurrency(value, currency)

  return (
    <div className="space-y-6">
      <Section title={t("goal.title")} description={t("goal.hint")}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label htmlFor="goal-select">{t("goal.goal")}</Label>
            <Select
              value={goal.id}
              onValueChange={(value) => {
                const next = goals.find((g) => g.id === value)
                if (!next) return
                setSelectedId(next.id)
                // The scenario restarts from the newly selected goal's own figures, so a plan is
                // never shown against a target it was not computed for.
                setState((previous) => ({
                  ...previous,
                  initialValue: String(Math.max(0, Math.round(next.currentValue))),
                  years: String(
                    Math.max(1, Math.round(yearsUntil(next.targetDate, new Date()) ?? 10)),
                  ),
                }))
              }}
            >
              <SelectTrigger id="goal-select" className="w-full">
                <SelectValue>
                  {(value) => goals.find((g) => g.id === value)?.label ?? t("goal.goal")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {goals.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{GOAL_DEFINITIONS[goal.type].measures}</p>
          </div>

          <NumberField
            id="goal-current"
            label={t("goal.startingFrom")}
            suffix={goal.unit === "percent" ? "%" : currency}
            value={state.initialValue}
            onChange={set("initialValue")}
            min={0}
            hint={`Today: ${money(goal.currentValue)}`}
          />
          <NumberField
            id="goal-contribution"
            label={t("inputs.contribution")}
            suffix={currency}
            value={state.contribution}
            onChange={set("contribution")}
            min={0}
          />
          <FrequencyField value={state.frequency} onChange={set("frequency")} />
          <ScenarioPicker value={state.scenario} onChange={pickScenario} />
          <NumberField
            id="goal-return"
            label={t("inputs.annualReturn")}
            suffix="%"
            value={state.annualReturnPct}
            onChange={set("annualReturnPct")}
          />
          <NumberField
            id="goal-years"
            label={t("inputs.duration")}
            suffix="years"
            value={state.years}
            onChange={set("years")}
            min={1}
            max={50}
            hint={
              goal.targetDate ? t("goal.targetDate", { date: formatDate(goal.targetDate, locale) }) : t("goal.noTargetDate")
            }
          />
          <NumberField
            id="goal-inflation"
            label={t("inputs.inflation")}
            suffix="%"
            value={state.inflationPct}
            onChange={set("inflationPct")}
            hint="Leave blank to skip real values."
          />
        </div>
      </Section>

      {!plan.ok ? (
        <p className="text-muted-foreground text-sm">
          N/A — {reason(t, plan.reason)}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">{t("goal.againstTarget")}</h2>
            <DataLabel kind="PROJECTED" />
          </div>

          <StatGrid>
            <StatCard label={t("goal.target")} value={money(targetValue)} emphasis />
            <StatCard
              label={t("goal.scenarioValue")}
              value={formatCurrencyWithCode(plan.value.projectedValue, currency)}
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {plan.value.projectedProgressPct === null
                    ? "N/A"
                    : `${formatPercent(plan.value.projectedProgressPct, { signed: false })} of target`}
                </span>
              }
            />
            <StatCard
              label={t("goal.projectedGap")}
              value={
                plan.value.projectedGap === 0 ? (
                  <span className="text-gain">{t("goal.targetMet")}</span>
                ) : (
                  formatCurrency(plan.value.projectedGap, currency)
                )
              }
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {plan.value.reachesTargetOn
                    ? t("goal.crossesOn", { date: formatDate(plan.value.reachesTargetOn, locale) })
                    : plan.value.alreadyReached
                      ? "Already at the target"
                      : "Not within this horizon"}
                </span>
              }
            />
            <StatCard
              label={t("goal.contributionNeeded")}
              value={
                required.ok ? (
                  formatCurrency(required.value, currency)
                ) : (
                  <span className="text-muted-foreground text-lg">N/A</span>
                )
              }
              emphasis
              hint={
                <span className="text-muted-foreground">
                  {required.ok
                    ? t("goal.toLandOnTarget", { frequency: tEnum(`contributionFrequency.${scenario.frequency}`) })
                    : (reason(t, required.reason, "NOT_COMPUTABLE"))}
                </span>
              }
            />
          </StatGrid>

          <Section title={t("goal.path")} description={t("goal.pathHint")}>
            <GrowthAreaChart
              points={plan.value.growth.points}
              currency={currency}
              targetValue={targetValue}
            />
          </Section>

          <Section
            title={t("goal.matrix")}
            description={t("goal.matrixHint")}
          >
            <div className="overflow-hidden rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>{t("goal.scenario")}</TableHead>
                    <TableHead className="text-right">{t("goal.return")}</TableHead>
                    <TableHead className="text-right">{t("inputs.contribution")}</TableHead>
                    <TableHead className="text-right">{t("goal.projectedValue")}</TableHead>
                    <TableHead className="text-right">{t("goal.projectedGap")}</TableHead>
                    <TableHead className="text-right">{t("goal.needed")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {matrix.map((row) => (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{tEnum(`scenarioName.${row.name}`)}</TableCell>
                      <TableCell className="tabular text-right">
                        {formatPercent(row.annualReturn * 100, { signed: false })}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {formatCurrency(row.contribution, currency)}
                      </TableCell>
                      <TableCell className="tabular text-right font-medium">
                        {row.projectedValue === null
                          ? "N/A"
                          : formatCurrency(row.projectedValue, currency)}
                      </TableCell>
                      <TableCell className="tabular text-muted-foreground text-right">
                        {row.projectedGap === null
                          ? "N/A"
                          : row.projectedGap === 0
                            ? "—"
                            : formatCurrency(row.projectedGap, currency)}
                      </TableCell>
                      <TableCell className="tabular text-right">
                        {row.requiredContribution === null
                          ? "N/A"
                          : formatCurrency(row.requiredContribution, currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="text-muted-foreground mt-3 text-xs">
              &ldquo;Needed&rdquo; is the contribution that lands exactly on the target under that
              rate, holding everything else. It is what the formula produces, not a recommendation.
            </p>
          </Section>

          <AssumptionPanel
            method={plan.value.growth.method}
            assumptions={[
              { label: t("goal.goal"), value: goal.label, hint: GOAL_DEFINITIONS[goal.type].label },
              { label: t("goal.target"), value: money(targetValue) },
              { label: t("goal.startingFrom"), value: money(scenario.initialValue) },
              {
                label: t("inputs.contribution"),
                value: formatCurrency(scenario.contribution, currency),
                hint: t("inputs.atPeriodEnd", { frequency: tEnum(`contributionFrequency.${scenario.frequency}`) }),
              },
              { label: t("inputs.annualReturn"), value: formatPercent(scenario.annualReturn * 100) },
              { label: t("inputs.duration"), value: `${scenario.years} years` },
              {
                label: t("inputs.inflation"),
                value:
                  scenario.inflationRate === null
                    ? "Not modelled"
                    : formatPercent(scenario.inflationRate * 100),
              },
              { label: t("inputs.currency"), value: currency },
            ]}
          />
        </>
      )}
    </div>
  )
}

/**
 * A refusal code becomes a sentence, with a fallback that is itself a message.
 *
 * The engine returns a reason for every scenario it will not model — never `NaN`, never
 * `Infinity` — and an unrecognised one still has to say something in the reader's language, which
 * is why the fallback is a key rather than an English string.
 */
function reason(
  t: (key: string) => string,
  code: string | undefined,
  fallback: "UNKNOWN" | "NOT_COMPUTABLE" = "UNKNOWN",
): string {
  const known = ["INVALID_INITIAL_VALUE", "INVALID_CONTRIBUTION", "INVALID_RETURN", "INVALID_DURATION",
    "INVALID_INFLATION", "NO_FX_RATE", "INSUFFICIENT_HISTORY", "TARGET_UNREACHABLE"]
  return t(`reasons.${code && known.includes(code) ? code : fallback}`)
}
