import type { Metadata } from "next"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { WatchlistTable } from "@/features/watchlist/components/watchlist-table"
import { loadWatchlist } from "@/features/watchlist/queries"
import { getTranslations } from "next-intl/server"

/** Localized per request: a title is a word, and this application has two sets of them. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("navigation")
  return { title: t("watchlist") }
}

export default async function WatchlistPage() {
  const tNav = await getTranslations("navigation")
  const t = await getTranslations("watchlist")
  const { items, quotes, technicals, marketDataError } = await loadWatchlist()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{tNav("watchlist")}</h1>
        <p className="text-muted-foreground text-sm">{t("hint")}</p>
      </div>

      {marketDataError && (
        <Alert>
          <AlertDescription>{marketDataError}</AlertDescription>
        </Alert>
      )}

      <WatchlistTable
        items={items}
        quotes={Object.fromEntries(quotes)}
        technicals={Object.fromEntries(
          [...technicals].map(([symbol, entry]) => [
            symbol,
            {
              rsi: entry.snapshot.rsi,
              adx: entry.snapshot.adx,
              relativeVolume: entry.snapshot.relativeVolume,
              score: entry.snapshot.score,
              trend: entry.snapshot.trend,
              stale: entry.stale,
            },
          ]),
        )}
      />
    </div>
  )
}
