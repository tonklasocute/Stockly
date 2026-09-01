import type { Metadata } from "next"
import { ScreenerClient } from "@/features/screener/components/screener-client"
import { MAX_UNIVERSE_SIZE } from "@/features/technical/universe"
import { createClient } from "@/lib/supabase/server"
import { isAIEnabled } from "@/services/ai"

export const metadata: Metadata = { title: "Screener" }

export default async function ScreenerPage() {
  const supabase = await createClient()
  // RLS scopes this to the caller's own saved screens.
  const [{ data: screens }, { count }] = await Promise.all([
    supabase.from("saved_screens").select("*").order("created_at", { ascending: false }),
    supabase.from("technical_snapshots").select("symbol", { count: "exact", head: true }),
  ])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Stock screener</h1>
        <p className="text-muted-foreground text-sm">
          {count ?? 0} stocks with technical data · refreshed on a schedule
        </p>
      </div>

      {(count ?? 0) === 0 && (
        <p className="text-muted-foreground rounded-xl border border-dashed px-4 py-3 text-sm">
          No technical snapshots have been computed yet. They are built by the scheduled job, which
          covers the stocks you hold, watch or have alerts on, plus a default list — up to{" "}
          {MAX_UNIVERSE_SIZE} symbols. Run the alert job once and this fills in.
        </p>
      )}

      <ScreenerClient savedScreens={screens ?? []} aiEnabled={isAIEnabled()} />
    </div>
  )
}
