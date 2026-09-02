"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CONTRIBUTION_FREQUENCIES,
  FREQUENCY_LABELS,
  SCENARIOS,
  SCENARIO_LABELS,
  SCENARIO_RETURNS,
  type ContributionFrequency,
  type ScenarioName,
} from "@/domain/simulation"

/**
 * One numeric assumption.
 *
 * Kept as a string in state rather than a number: a controlled number input that coerces on every
 * keystroke cannot be cleared, and cannot hold "0." on the way to "0.5". The parse happens once, at
 * the engine boundary, where an unusable value produces a reason instead of a NaN.
 */
export function NumberField({
  id,
  label,
  value,
  onChange,
  suffix,
  hint,
  min,
  max,
  step = "any",
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  suffix?: string
  hint?: string
  min?: number
  max?: number
  step?: string
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>
        {label}
        {suffix ? <span className="text-muted-foreground font-normal"> ({suffix})</span> : null}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        min={min}
        max={max}
        className="tabular"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  )
}

export function FrequencyField({
  value,
  onChange,
}: {
  value: ContributionFrequency
  onChange: (value: ContributionFrequency) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="simulation-frequency">How often</Label>
      <Select
        value={value}
        onValueChange={(next) => onChange((next as ContributionFrequency) ?? "MONTHLY")}
      >
        <SelectTrigger id="simulation-frequency" className="w-full">
          <SelectValue>{(v) => FREQUENCY_LABELS[v as ContributionFrequency]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {CONTRIBUTION_FREQUENCIES.map((frequency) => (
            <SelectItem key={frequency} value={frequency}>
              {FREQUENCY_LABELS[frequency]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

/**
 * The three named starting points.
 *
 * Picking one fills the return field and leaves it editable, so the number in play is always the
 * one on screen. The rates are labelled an *example assumption* rather than presented as Stockly's
 * view — they are not derived from anything, and pretending otherwise would be the pseudo-precision
 * the phase brief rules out.
 */
export function ScenarioPicker({
  value,
  onChange,
}: {
  value: ScenarioName
  onChange: (scenario: ScenarioName, annualReturnPct: number) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="simulation-scenario">Scenario</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          const scenario = (next as ScenarioName) ?? "BASE"
          onChange(scenario, SCENARIO_RETURNS[scenario] * 100)
        }}
      >
        <SelectTrigger id="simulation-scenario" className="w-full">
          <SelectValue>{(v) => SCENARIO_LABELS[v as ScenarioName]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {SCENARIOS.map((scenario) => (
            <SelectItem key={scenario} value={scenario}>
              {SCENARIO_LABELS[scenario]} · {(SCENARIO_RETURNS[scenario] * 100).toFixed(0)}%
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        Example assumptions, not forecasts. Edit the rate to use your own.
      </p>
    </div>
  )
}
