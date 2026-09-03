import "server-only"

import { cache } from "react"
import type { MarketId } from "@/domain/market"
import { serverEnv } from "@/lib/env.server"
import { logger } from "@/lib/log"
import { mockFundamentalProvider } from "./mock-provider"
import { unavailableFundamentalProvider } from "./unavailable-provider"
import type { FundamentalDataProvider } from "./types"

/**
 * Provider selection for fundamentals.
 *
 * The same two ideas as `services/market-data/index.ts`, and deliberately the same shape: which
 * implementation, and which market goes to which implementation. No vendor name appears outside
 * this folder, and adding one is an adapter plus a case below.
 *
 * The default is **`unavailable`**, not `mock`. A deployment with no fundamentals vendor should
 * say it has none — a mock in production would render synthetic revenue as a company's accounts,
 * and `FUNDAMENTALS_PROVIDER=mock` has to be typed deliberately to get it.
 */
function create(name: string): FundamentalDataProvider {
  switch (name) {
    case "mock":
      return mockFundamentalProvider
    case "none":
    case "":
      return unavailableFundamentalProvider
    default:
      logger.warn("fundamentals.unknown_provider", { provider: name })
      return unavailableFundamentalProvider
  }
}

export const getFundamentalProvider = cache((): FundamentalDataProvider =>
  create(serverEnv.fundamentalsProvider),
)

/**
 * Whether this deployment can answer fundamental questions for a market at all.
 *
 * Read by every fundamentals surface before it renders an empty state, so "not configured" and
 * "this company reports nothing" are different sentences.
 */
export function coversMarket(market: MarketId): boolean {
  return getFundamentalProvider().capabilities.markets.includes(market)
}

export { FundamentalError, isFundamentalError } from "./errors"
export type { FundamentalCapabilities, FundamentalDataProvider, DividendPayment } from "./types"
