import { z } from "zod"
import type { Currency } from "@/domain/market"
import type { FxRate } from "@/domain/fx"
import { fetchJson } from "@/services/market-data/http"
import { isMarketDataError } from "@/services/market-data/errors"
import { logger } from "@/lib/log"
import type { FxPairRequest, FxRateProvider } from "./types"

/**
 * Twelve Data's `/exchange_rate` endpoint, reusing the market-data fetcher — the same timeout, the
 * same Next Data Cache, the same rule that the API key is never logged. Sharing the transport is
 * deliberate: FX and quotes come from the same account and the same rate limit, so they should
 * share the one place that knows how to talk to it.
 *
 * Ten minutes of caching. An FX rate that moves a tenth of a percent in ten minutes changes a
 * portfolio total by a tenth of a percent, and a rate refreshed per request would spend the free
 * tier's daily credits on a number that barely moved.
 *
 * `ponytail:` ceiling — one credit per pair, no batch endpoint. A portfolio spanning five
 * currencies costs five credits per cache window, which is fine at this scale. A provider with a
 * bulk rates endpoint would implement `getRates` as one call and nothing else would change.
 */
const FX_REVALIDATE_SECONDS = 600

/** The provider returns numbers as strings, and an error as a body with a `code`. */
const exchangeRateSchema = z.object({
  symbol: z.string().optional(),
  rate: z.union([z.number(), z.string()]).optional(),
  timestamp: z.union([z.number(), z.string()]).optional(),
  code: z.number().optional(),
  status: z.string().optional(),
})

function toNumber(value: number | string | undefined): number | null {
  if (value === undefined) return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** Seconds since the epoch, as the provider sends it. Anything unusable becomes "now". */
function toIso(timestamp: number | string | undefined): string {
  const seconds = toNumber(timestamp)
  if (seconds === null || seconds <= 0) return new Date().toISOString()
  return new Date(seconds * 1000).toISOString()
}

export function createTwelveDataFxProvider(config: {
  apiKey: string
  baseUrl: string
}): FxRateProvider {
  async function fetchRate(base: Currency, quote: Currency): Promise<FxRate | null> {
    if (base === quote) {
      return { base, quote, rate: 1, asOf: new Date().toISOString(), provider: "twelvedata" }
    }

    try {
      const payload = await fetchJson<unknown>(config.baseUrl, "exchange_rate", config.apiKey, {
        revalidate: FX_REVALIDATE_SECONDS,
        tags: [`fx:${base}:${quote}`],
        searchParams: { symbol: `${base}/${quote}` },
      })

      const parsed = exchangeRateSchema.safeParse(payload)
      const rate = parsed.success ? toNumber(parsed.data.rate) : null
      // A pair the provider does not cover comes back as an error body, not an HTTP error. Both
      // mean the same thing here: no rate, so no conversion, so "N/A" downstream.
      if (!parsed.success || rate === null || rate <= 0) {
        logger.warn("fx.pair_unavailable", { provider: "twelvedata", pair: `${base}/${quote}` })
        return null
      }

      return { base, quote, rate, asOf: toIso(parsed.data.timestamp), provider: "twelvedata" }
    } catch (error) {
      // FX degrades, it does not cascade: a failed rate costs one converted figure, not the page.
      logger.error("fx.request_failed", {
        provider: "twelvedata",
        pair: `${base}/${quote}`,
        code: isMarketDataError(error) ? error.code : "UNKNOWN",
      })
      return null
    }
  }

  return {
    name: "twelvedata",

    getRate: fetchRate,

    async getRates(pairs: readonly FxPairRequest[]) {
      const results = await Promise.all(pairs.map((p) => fetchRate(p.base, p.quote)))
      return results.filter((r): r is FxRate => r !== null)
    },
  }
}
