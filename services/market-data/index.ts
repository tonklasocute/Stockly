import "server-only"

import { cache } from "react"
import { serverEnv } from "@/lib/env.server"
import { MarketDataError } from "./errors"
import { mockMarketDataProvider } from "./mock-provider"
import { createTwelveDataProvider } from "./twelve-data-provider"
import type { MarketDataProvider } from "./types"

/**
 * The single place a provider is chosen. Everything else depends only on the interface, so adding
 * Polygon or Alpha Vantage is a new adapter plus one case here.
 *
 * Server-only: the adapter closes over the API key, which must never reach the browser.
 */
export const getMarketDataProvider = cache((): MarketDataProvider => {
  switch (serverEnv.marketDataProvider) {
    case "mock":
      return mockMarketDataProvider

    case "twelvedata": {
      if (!serverEnv.marketDataApiKey) throw MarketDataError.notConfigured()
      return createTwelveDataProvider({
        apiKey: serverEnv.marketDataApiKey,
        baseUrl: serverEnv.marketDataBaseUrl,
      })
    }

    default:
      console.warn(
        `[market-data] Unknown provider "${serverEnv.marketDataProvider}"; using mock prices instead.`,
      )
      return mockMarketDataProvider
  }
})

export { MarketDataError, isMarketDataError } from "./errors"
export { RANGES } from "./types"
export type * from "./types"
