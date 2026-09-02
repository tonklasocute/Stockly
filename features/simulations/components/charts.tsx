"use client"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { DividendYear } from "@/domain/simulation"
import type { GrowthPoint } from "@/domain/simulation"
import { formatCurrency } from "@/lib/format"

const TOOLTIP = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  color: "var(--popover-foreground)",
  fontSize: "0.8125rem",
}

const AXIS = { fontSize: 11, fill: "var(--muted-foreground)" }

/** Year labels only: 120 monthly ticks are unreadable at any width. */
function yearTick(date: string): string {
  return date.slice(0, 4)
}

/**
 * Contributions and growth, stacked.
 *
 * The stack is the point of the chart, not decoration: it shows at a glance how much of a projected
 * balance is money the user would pay in and how much is the assumed return. A single line would
 * let a 6% assumption look like an achievement.
 *
 * Every series is drawn **dashed**, and the panel above carries a PROJECTED label. Nothing on this
 * chart happened; styling it like the actual performance line on the analytics page would be a
 * visual claim the data does not support.
 */
export function GrowthAreaChart({
  points,
  currency,
  targetValue,
}: {
  points: GrowthPoint[]
  currency: string
  /** Drawn as a reference line when a goal is being planned against. */
  targetValue?: number | null
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={yearTick}
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          minTickGap={32}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(value: number) => formatCurrency(value, currency, 0)}
        />
        <Tooltip
          contentStyle={TOOLTIP}
          labelFormatter={(label) => `Projected · ${String(label)}`}
          formatter={(value, name) => [formatCurrency(Number(value), currency), String(name)]}
        />
        <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
        <Area
          type="monotone"
          dataKey="contributed"
          name="Paid in"
          stackId="1"
          stroke="var(--chart-2)"
          fill="var(--chart-2)"
          fillOpacity={0.35}
          strokeDasharray="4 3"
        />
        <Area
          type="monotone"
          dataKey="growth"
          name="Scenario growth"
          stackId="1"
          stroke="var(--chart-1)"
          fill="var(--chart-1)"
          fillOpacity={0.25}
          strokeDasharray="4 3"
        />
        {targetValue != null && targetValue > 0 && (
          <ReferenceLine
            y={targetValue}
            stroke="var(--chart-4)"
            strokeDasharray="6 4"
            label={{ value: "Target", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Final scenario values side by side — one bar per assumed return. */
export function ScenarioComparisonChart({
  rows,
  currency,
  targetValue,
}: {
  rows: Array<{ label: string; value: number | null }>
  currency: string
  targetValue?: number | null
}) {
  const data = rows.filter((row) => row.value !== null)
  if (data.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">N/A — nothing to compare.</p>
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(value: number) => formatCurrency(value, currency, 0)}
        />
        <Tooltip
          contentStyle={TOOLTIP}
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          formatter={(value) => [formatCurrency(Number(value), currency), "Projected value"]}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((_, index) => (
            <Cell key={index} fill={`var(--chart-${(index % 5) + 1})`} />
          ))}
        </Bar>
        {targetValue != null && targetValue > 0 && (
          <ReferenceLine
            y={targetValue}
            stroke="var(--chart-4)"
            strokeDasharray="6 4"
            label={{ value: "Target", position: "insideTopRight", fill: "var(--muted-foreground)", fontSize: 11 }}
          />
        )}
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Projected income per year. Bars, because a dividend is a discrete annual event, not a curve. */
export function DividendProjectionChart({
  years,
  currency,
}: {
  years: DividendYear[]
  currency: string
}) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={years} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="year"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `Y${value}`}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={64}
          tickFormatter={(value: number) => formatCurrency(value, currency, 0)}
        />
        <Tooltip
          contentStyle={TOOLTIP}
          cursor={{ fill: "var(--muted)", opacity: 0.3 }}
          labelFormatter={(label) => `Projected · year ${String(label)}`}
          formatter={(value) => [formatCurrency(Number(value), currency), "Projected income"]}
        />
        <Bar dataKey="projectedIncome" fill="var(--chart-3)" radius={[4, 4, 0, 0]} fillOpacity={0.75} />
      </BarChart>
    </ResponsiveContainer>
  )
}
