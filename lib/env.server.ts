import "server-only"

/**
 * Server-only environment. Importing this from a client component is a build error, which is the
 * point: MARKET_DATA_API_KEY must never be reachable from the browser bundle.
 */
export const serverEnv = {
  /** "mock" needs no key and keeps the app usable without a provider account. */
  get marketDataProvider() {
    return process.env.MARKET_DATA_PROVIDER ?? "mock"
  },
  get marketDataApiKey() {
    return process.env.MARKET_DATA_API_KEY ?? ""
  },
  get marketDataBaseUrl() {
    return process.env.MARKET_DATA_BASE_URL ?? "https://api.twelvedata.com"
  },
}
