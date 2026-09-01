import "server-only"

import { env } from "@/lib/env"
import { mockMarketDataProvider } from "./mock-provider"
import type { MarketDataProvider } from "./types"

/**
 * The single place a provider is chosen. Phase 2 adds real providers here; nothing else changes.
 * Server-only: a real provider will hold an API key.
 */
export function getMarketDataProvider(): MarketDataProvider {
  switch (env.marketDataProvider) {
    case "mock":
      return mockMarketDataProvider
    default:
      console.warn(
        `[market-data] Unknown provider "${env.marketDataProvider}", falling back to mock.`,
      )
      return mockMarketDataProvider
  }
}

export type * from "./types"
