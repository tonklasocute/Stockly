import "server-only"

import { cache } from "react"
import { relevantEvents, type CorporateEvent } from "@/domain/corporate-events"
import { symbolKey, type MarketId } from "@/domain/market"
import { coversMarket, getFundamentalProvider } from "@/services/fundamentals"
import { loadPortfolioView } from "@/features/portfolios/portfolio-view"
import { watchedSymbols } from "@/features/watchlist/queries"
import { describeError, logger } from "@/lib/log"

/**
 * Upcoming events for the instruments a user actually holds or watches.
 *
 * Two costs are deliberately bounded here, because this is the surface where a naive implementation
 * turns into a provider bill:
 *
 * - **One provider call per distinct instrument, capped**, never one per holding *per render*. A
 *   fifty-position portfolio would otherwise cost fifty calls every time somebody opened the
 *   dashboard.
 * - **Only held and watched instruments.** A calendar of every listed company is a news feed, and
 *   the dashboard is not one.
 *
 * The portfolio relationship is the private part. The events themselves are public reference data;
 * *that this user holds AAPL* is not, and `relevantEvents` is where the two are joined — on the
 * server, under the user's own session.
 */

/** The most instruments one page will ask a provider about. */
export const MAX_EVENT_INSTRUMENTS = 25

export type PortfolioEvent = CorporateEvent & { relation: "HELD" | "WATCHED" }

export type PortfolioEventsBundle = {
  events: PortfolioEvent[]
  /** False when this deployment has no fundamentals provider — a different empty state. */
  covered: boolean
  /** Instruments that were not asked about because of the cap, so the UI can say so. */
  omitted: number
}

export const loadPortfolioEvents = cache(
  async (portfolioId: string | null): Promise<PortfolioEventsBundle> => {
    const provider = getFundamentalProvider()
    if (provider.capabilities.markets.length === 0 || !provider.capabilities.corporateEvents) {
      return { events: [], covered: false, omitted: 0 }
    }

    const [view, watched] = await Promise.all([
      portfolioId ? loadPortfolioView(portfolioId).catch(() => null) : Promise.resolve(null),
      watchedSymbols().catch(() => new Set<string>()),
    ])

    const held = new Set(
      (view?.holdings ?? [])
        .filter((holding) => holding.quantity > 0)
        .map((holding) => symbolKey(holding.symbol, holding.market)),
    )

    // Held first, so the cap drops watched instruments before owned ones.
    const instruments: Array<{ symbol: string; market: MarketId }> = []
    const seen = new Set<string>()
    const add = (key: string) => {
      const [market, symbol] = key.split(":")
      if (seen.has(key) || !market || !symbol) return
      if (!coversMarket(market as MarketId)) return
      seen.add(key)
      instruments.push({ symbol, market: market as MarketId })
    }
    for (const key of held) add(key)
    for (const key of watched) add(key)

    const asked = instruments.slice(0, MAX_EVENT_INSTRUMENTS)

    const results = await Promise.allSettled(
      asked.map((instrument) => provider.getCorporateEvents(instrument.symbol, instrument.market)),
    )

    const events: CorporateEvent[] = []
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        events.push(...result.value)
      } else {
        // One instrument's failure costs that instrument, not the section.
        logger.warn("fundamentals.events_failed", {
          symbol: asked[index].symbol,
          market: asked[index].market,
          ...describeError(result.reason),
        })
      }
    }

    return {
      events: relevantEvents(events, held, watched, new Date()),
      covered: true,
      omitted: Math.max(0, instruments.length - asked.length),
    }
  },
)
