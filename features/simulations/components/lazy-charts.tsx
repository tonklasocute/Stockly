"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Recharts is the heaviest thing on this page and none of it is above the fold on a phone, so it
 * streams in after the inputs are interactive. `ssr: false` because Recharts measures the DOM to
 * size itself — server-rendering it produces markup the client immediately discards.
 */
const chartSkeleton = (height: string) => {
  const Loading = () => <Skeleton className={`w-full rounded-xl ${height}`} />
  Loading.displayName = "ChartSkeleton"
  return Loading
}

export const GrowthAreaChart = dynamic(
  () => import("./charts").then((m) => m.GrowthAreaChart),
  { ssr: false, loading: chartSkeleton("h-[260px]") },
)

export const ScenarioComparisonChart = dynamic(
  () => import("./charts").then((m) => m.ScenarioComparisonChart),
  { ssr: false, loading: chartSkeleton("h-[200px]") },
)

export const DividendProjectionChart = dynamic(
  () => import("./charts").then((m) => m.DividendProjectionChart),
  { ssr: false, loading: chartSkeleton("h-[220px]") },
)
