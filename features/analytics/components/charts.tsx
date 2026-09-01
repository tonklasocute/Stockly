"use client"

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { AllocationSlice, PerformancePoint } from "@/domain/analytics"
import type { DividendPeriod } from "@/domain/dividends"
import { formatCurrency, formatPercent } from "@/lib/format"

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

const TOOLTIP = {
  background: "var(--popover)",
  border: "1px solid var(--border)",
  borderRadius: "0.5rem",
  color: "var(--popover-foreground)",
  fontSize: "0.8125rem",
}

/** Beyond the top slices the tail is grouped, so a legend stays readable at 390px. */
function collapse(slices: readonly AllocationSlice[], keep: number): AllocationSlice[] {
  if (slices.length <= keep + 1) return [...slices]
  const head = slices.slice(0, keep)
  const tail = slices.slice(keep)
  return [
    ...head,
    {
      key: "__other",
      label: `${tail.length} more`,
      value: tail.reduce((sum, s) => sum + s.value, 0),
      weight: tail.reduce((sum, s) => sum + s.weight, 0),
    },
  ]
}

export function AllocationDonut({
  slices,
  currency,
  keep = 6,
}: {
  slices: AllocationSlice[]
  currency: string
  keep?: number
}) {
  const data = collapse(slices, keep)
  if (data.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">Nothing to allocate yet.</p>
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,10rem)_1fr] sm:items-center">
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {data.map((slice, index) => (
                <Cell
                  key={slice.key}
                  fill={slice.key === "__cash" ? "var(--muted-foreground)" : COLORS[index % COLORS.length]}
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={TOOLTIP}
              formatter={(value, name) => [formatCurrency(Number(value), currency), String(name)]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* The table is the accessible source of truth; the chart is a summary of it. */}
      <ul className="grid gap-1.5 text-sm sm:max-w-sm">
        {data.map((slice, index) => (
          <li key={slice.key} className="flex items-center gap-2.5">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{
                background:
                  slice.key === "__cash" ? "var(--muted-foreground)" : COLORS[index % COLORS.length],
              }}
              aria-hidden
            />
            <span className="flex-1 truncate">{slice.label}</span>
            <span className="tabular text-muted-foreground">
              {formatPercent(slice.weight, { signed: false })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PerformanceChart({
  points,
  currency,
}: {
  points: PerformancePoint[]
  currency: string
}) {
  const values = points.map((p) => p.totalValue)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = (max - min || max * 0.02) * 0.12
  const rising = values.length > 1 && values[values.length - 1] >= values[0]
  const stroke = rising ? "var(--gain)" : "var(--loss)"

  return (
    <div className="h-56 sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="perf-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={62}
            tickFormatter={(value: number) => formatCurrency(value, currency, 0)}
          />
          <Tooltip
            contentStyle={TOOLTIP}
            formatter={(value, name) => [
              formatCurrency(Number(value), currency),
              name === "totalValue" ? "Portfolio value" : "Invested",
            ]}
          />
          <Area
            type="monotone"
            dataKey="investedValue"
            stroke="var(--muted-foreground)"
            strokeWidth={1.25}
            strokeDasharray="4 4"
            fill="none"
            isAnimationActive={false}
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="totalValue"
            stroke={stroke}
            strokeWidth={1.75}
            fill="url(#perf-fill)"
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export function DividendBars({
  periods,
  currency,
}: {
  periods: DividendPeriod[]
  currency: string
}) {
  return (
    <div className="h-52 sm:h-60">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={periods} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            minTickGap={16}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={58}
            tickFormatter={(value: number) => formatCurrency(value, currency, 0)}
          />
          <Tooltip
            cursor={{ fill: "var(--accent)" }}
            contentStyle={TOOLTIP}
            formatter={(value) => [formatCurrency(Number(value), currency), "Net"]}
          />
          <Bar dataKey="net" fill="var(--chart-2)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
