"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Charts are the heaviest thing on the analytics page and none of them is above the fold on a
 * phone. Loading them separately keeps the page interactive while the chart library streams in.
 *
 * `ssr: false` because Recharts measures the DOM to size itself: server-rendering it produces markup
 * the client immediately discards, which costs bytes twice and does nothing for first paint.
 */
const chartSkeleton = (height: string) => {
  const Loading = () => <Skeleton className={`w-full rounded-xl ${height}`} />
  Loading.displayName = "ChartSkeleton"
  return Loading
}

export const AllocationDonut = dynamic(
  () => import("./charts").then((m) => m.AllocationDonut),
  { ssr: false, loading: chartSkeleton("h-40") },
)

export const PerformanceChart = dynamic(
  () => import("./charts").then((m) => m.PerformanceChart),
  { ssr: false, loading: chartSkeleton("h-56 sm:h-64") },
)

export const DividendBars = dynamic(
  () => import("./charts").then((m) => m.DividendBars),
  { ssr: false, loading: chartSkeleton("h-52 sm:h-60") },
)
