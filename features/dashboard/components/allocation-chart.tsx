"use client"

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts"
import type { Holding } from "@/domain/types"
import { formatCurrency, formatPercent } from "@/lib/format"

const COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

/**
 * Anything past the top five is grouped, so the legend stays readable on a phone.
 *
 * Values are the base-currency ones: a pie mixing dollars and baht compares nothing. A holding with
 * no exchange rate has no comparable value and is left out entirely — the page says so beside the
 * chart rather than the chart implying the position is worth nothing.
 */
function toSlices(holdings: Holding[]) {
  const translated = holdings.filter((h) => h.baseMarketValue !== null)
  const top = translated.slice(0, 5)
  const rest = translated.slice(5)
  const slices = top.map((h) => ({
    name: h.symbol,
    value: h.baseMarketValue ?? 0,
    weight: h.weight ?? 0,
  }))
  if (rest.length) {
    slices.push({
      name: `${rest.length} more`,
      value: rest.reduce((s, h) => s + (h.baseMarketValue ?? 0), 0),
      weight: rest.reduce((s, h) => s + (h.weight ?? 0), 0),
    })
  }
  return slices
}

export function AllocationChart({
  holdings,
  currency,
}: {
  holdings: Holding[]
  currency: string
}) {
  const slices = toSlices(holdings)

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(0,11rem)_1fr] sm:items-center">
      <div className="h-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="100%"
              paddingAngle={2}
              stroke="none"
              isAnimationActive={false}
            >
              {slices.map((_, index) => (
                <Cell key={index} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: "0.5rem",
                color: "var(--popover-foreground)",
                fontSize: "0.8125rem",
              }}
              formatter={(value, name) => [formatCurrency(Number(value), currency), String(name)]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <ul className="grid gap-1.5 text-sm sm:max-w-xs">
        {slices.map((slice, index) => (
          <li key={slice.name} className="flex items-center gap-2.5">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: COLORS[index % COLORS.length] }}
              aria-hidden
            />
            <span className="flex-1 truncate font-medium">{slice.name}</span>
            <span className="tabular text-muted-foreground">
              {formatPercent(slice.weight, { signed: false })}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
