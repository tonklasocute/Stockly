import type { Currency } from "@/domain/market"
import type { FxRate } from "@/domain/fx"

export type FxPairRequest = { base: Currency; quote: Currency }

/**
 * The only FX surface the application knows. Swapping providers is one case in `index.ts`; no
 * provider name appears outside this folder, and no provider payload shape escapes its adapter.
 *
 * `getRates` exists so a request needing three pairs costs one round of calls, not three sequential
 * ones — and so a provider with a batch endpoint can use it without any caller changing.
 *
 * **Every method resolves.** A pair the provider does not know is `null`; an outage is `null` too,
 * logged by the adapter. FX is a translation layered on top of a portfolio that already works, so a
 * provider being down must degrade a number to "N/A" — never throw a page away.
 */
export interface FxRateProvider {
  readonly name: string
  getRate(base: Currency, quote: Currency): Promise<FxRate | null>
  getRates(pairs: readonly FxPairRequest[]): Promise<FxRate[]>
}
