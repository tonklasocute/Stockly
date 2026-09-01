import type { Metadata } from "next"
import { BarChart3 } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

export const metadata: Metadata = { title: "Analytics" }

export default function AnalyticsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Analytics</h1>
      <div className="rounded-xl border">
        <EmptyState
          icon={BarChart3}
          title="Coming in phase 3"
          description="This page is part of a later phase. Your portfolio, transactions and dashboard are ready to use now."
        />
      </div>
    </div>
  )
}
