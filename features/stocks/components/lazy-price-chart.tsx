"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"

/** The header and your position render immediately; the chart library follows. */
export const PriceChart = dynamic(
  () => import("./price-chart").then((m) => m.PriceChart),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full rounded-xl sm:h-72" /> },
)
