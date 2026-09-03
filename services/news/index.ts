import "server-only"

import { cache } from "react"
import type { MarketId } from "@/domain/market"
import { serverEnv } from "@/lib/env.server"
import { logger } from "@/lib/log"
import { mockNewsProvider } from "./mock-provider"
import { unavailableNewsProvider } from "./unavailable-provider"
import type { NewsProvider } from "./types"

/**
 * Provider selection for news.
 *
 * Defaults to **`none`**, never `mock`. A mock in production would attribute invented headlines to
 * publications, which is the one thing in this phase that could not be defended — `NEWS_PROVIDER=mock`
 * has to be typed deliberately.
 */
function create(name: string): NewsProvider {
  switch (name) {
    case "mock":
      return mockNewsProvider
    case "none":
    case "":
      return unavailableNewsProvider
    default:
      logger.warn("news.unknown_provider", { provider: name })
      return unavailableNewsProvider
  }
}

export const getNewsProvider = cache((): NewsProvider => create(serverEnv.newsProvider))

/** Whether this deployment can answer news questions for a market at all. */
export function coversMarket(market: MarketId): boolean {
  return getNewsProvider().capabilities.markets.includes(market)
}

export type { NewsProvider, NewsCapabilities, NewsQuery, RawArticle } from "./types"
