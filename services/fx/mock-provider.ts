import type { Currency } from "@/domain/market"
import type { FxRate } from "@/domain/fx"
import type { FxPairRequest, FxRateProvider } from "./types"

/**
 * Deterministic rates so multi-currency portfolios are fully usable without an FX account — for
 * local development, for the test suite, and for anyone who has not signed up for a provider.
 * Selected with FX_PROVIDER=mock, which is the default.
 *
 * Only pairs that are actually listed resolve. A pair that is absent returns null, which is the
 * whole point: the "no rate available" path is the one most likely to be wrong in production, so
 * the mock has to be able to reproduce it.
 */
const RATES: Partial<Record<string, number>> = {
  "USD/THB": 32.45,
  "USD/EUR": 0.92,
  "USD/GBP": 0.78,
  "USD/JPY": 151.2,
  "USD/SGD": 1.34,
  "USD/HKD": 7.81,
  "THB/EUR": 0.028,
}

function rateFor(base: Currency, quote: Currency): FxRate | null {
  if (base === quote) {
    return { base, quote, rate: 1, asOf: new Date().toISOString(), provider: "mock" }
  }
  const direct = RATES[`${base}/${quote}`]
  if (direct !== undefined) {
    return { base, quote, rate: direct, asOf: new Date().toISOString(), provider: "mock" }
  }
  const inverse = RATES[`${quote}/${base}`]
  if (inverse !== undefined && inverse > 0) {
    return { base, quote, rate: 1 / inverse, asOf: new Date().toISOString(), provider: "mock" }
  }
  return null
}

export const mockFxRateProvider: FxRateProvider = {
  name: "mock",

  async getRate(base, quote) {
    return rateFor(base, quote)
  },

  async getRates(pairs: readonly FxPairRequest[]) {
    return pairs.map((p) => rateFor(p.base, p.quote)).filter((r): r is FxRate => r !== null)
  },
}
