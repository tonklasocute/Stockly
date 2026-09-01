import type { Metadata } from "next"
import { Eye } from "lucide-react"
import { EmptyState } from "@/components/empty-state"

export const metadata: Metadata = { title: "Watchlist" }

export default function WatchlistPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Watchlist</h1>
      <div className="rounded-xl border">
        <EmptyState
          icon={Eye}
          title="Coming in phase 2"
          description="This page is part of a later phase. Your portfolio, transactions and dashboard are ready to use now."
        />
      </div>
    </div>
  )
}
