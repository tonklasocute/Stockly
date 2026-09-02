import "server-only"

import { cache } from "react"
import { buildFxTable, fxPair, type FxRate, type FxTable } from "@/domain/fx"
import { CURRENCIES, isCurrency, type Currency } from "@/domain/market"
import { serverEnv } from "@/lib/env.server"
import { logger } from "@/lib/log"
import { mockFxRateProvider } from "./mock-provider"
import { createTwelveDataFxProvider } from "./twelve-data-fx-provider"
import type { FxPairRequest, FxRateProvider } from "./types"

/**
 * A provider that knows no rates at all.
 *
 * This is the fallback for an unrecognised `FX_PROVIDER`, and it is deliberately not the mock. Mock
 * rates in production would be a fabricated number sitting where a portfolio total goes — the exact
 * failure this codebase treats as worse than a gap. Knowing nothing renders "N/A", which is true.
 */
const nullFxRateProvider: FxRateProvider = {
  name: "none",
  async getRate() {
    return null
  },
  async getRates() {
    return []
  },
}

/**
 * The single place an FX provider is chosen.
 *
 * `FX_PROVIDER` defaults to whatever `MARKET_DATA_PROVIDER` is set to, because the two are the same
 * account on the same rate limit and running live prices against mock rates is never what anyone
 * meant. Set it explicitly to override.
 */
export const getFxRateProvider = cache((): FxRateProvider => {
  switch (serverEnv.fxProvider) {
    case "mock":
      return mockFxRateProvider

    case "twelvedata": {
      if (!serverEnv.marketDataApiKey) {
        logger.warn("fx.not_configured", { provider: "twelvedata" })
        return nullFxRateProvider
      }
      return createTwelveDataFxProvider({
        apiKey: serverEnv.marketDataApiKey,
        baseUrl: serverEnv.marketDataBaseUrl,
      })
    }

    default:
      logger.warn("fx.unknown_provider", { provider: serverEnv.fxProvider })
      return nullFxRateProvider
  }
})

/**
 * Every rate one request needs, fetched once.
 *
 * The pairs are `base -> ...others`, so a portfolio holding dollars and baht with a baht base
 * currency asks for USD/THB and nothing else. `cache()` deduplicates within a render — the
 * dashboard's summary, its allocation chart and its holdings table share one table — and the
 * adapter's own Next Data Cache deduplicates across requests and across serverless instances.
 * Ten holdings never become ten FX calls; they become at most one per distinct pair per ten
 * minutes, for the whole deployment.
 */
const loadFxTableFor = cache(async (base: Currency, key: string): Promise<FxTable> => {
  const quotes = key
    .split(",")
    .filter((c): c is Currency => isCurrency(c) && c !== base)

  if (quotes.length === 0) return buildFxTable([])

  const pairs: FxPairRequest[] = quotes.map((quote) => ({ base: quote, quote: base }))

  let rates: FxRate[] = []
  try {
    rates = await getFxRateProvider().getRates(pairs)
  } catch (error) {
    // The interface says every method resolves; this is belt and braces so a badly-behaved adapter
    // costs conversions rather than the page.
    logger.error("fx.table_failed", {
      provider: getFxRateProvider().name,
      message: error instanceof Error ? error.message : String(error),
    })
  }

  const found = new Set(rates.map((r) => fxPair(r.base, r.quote)))
  const missing = pairs.map((p) => fxPair(p.base, p.quote)).filter((p) => !found.has(p))
  if (missing.length > 0) logger.warn("fx.pairs_missing", { pairs: missing.join(" ") })

  return buildFxTable(rates, missing)
})

/** Sorted and de-duplicated, so `cache()` sees the same key for the same set of currencies. */
export function loadFxTable(
  base: Currency,
  currencies: readonly Currency[],
): Promise<FxTable> {
  const key = [...new Set(currencies)]
    .filter((c) => c !== base)
    .sort()
    .join(",")
  return loadFxTableFor(base, key)
}

/** Every rate against one base currency — for the data-health view, which lists them all. */
export function loadAllFxRates(base: Currency): Promise<FxTable> {
  return loadFxTable(base, CURRENCIES)
}

export type { FxPairRequest, FxRateProvider }
