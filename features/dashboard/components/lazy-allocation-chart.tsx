"use client"

import dynamic from "next/dynamic"
import { Skeleton } from "@/components/ui/skeleton"

/** Below the fold on every screen size, so it is never part of the dashboard's first paint. */
export const AllocationChart = dynamic(
  () => import("./allocation-chart").then((m) => m.AllocationChart),
  { ssr: false, loading: () => <Skeleton className="h-44 w-full rounded-xl" /> },
)
