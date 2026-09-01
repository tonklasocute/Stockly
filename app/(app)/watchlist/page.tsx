import type { Metadata } from "next"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { WatchlistTable } from "@/features/watchlist/components/watchlist-table"
import { loadWatchlist } from "@/features/watchlist/queries"

export const metadata: Metadata = { title: "Watchlist" }

export default async function WatchlistPage() {
  const { items, quotes, marketDataError } = await loadWatchlist()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Watchlist</h1>
        <p className="text-muted-foreground text-sm">
          Stocks you are tracking but do not own. Press ⌘K to find one.
        </p>
      </div>

      {marketDataError && (
        <Alert>
          <AlertDescription>{marketDataError}</AlertDescription>
        </Alert>
      )}

      <WatchlistTable items={items} quotes={Object.fromEntries(quotes)} />
    </div>
  )
}
