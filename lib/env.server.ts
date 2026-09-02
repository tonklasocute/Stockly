import "server-only"

/**
 * Server-only environment. Importing this from a client component is a build error, which is the
 * point: MARKET_DATA_API_KEY must never be reachable from the browser bundle.
 */
function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

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
  /**
   * Which provider prices SET (Thai) instruments. Defaults to the main provider, so a deployment
   * that adds a Thai data vendor later changes one variable and nothing else.
   */
  get setMarketDataProvider() {
    return process.env.MARKET_DATA_PROVIDER_SET ?? process.env.MARKET_DATA_PROVIDER ?? "mock"
  },
  /**
   * Where exchange rates come from. Defaults to the market-data provider: they are the same account
   * on the same rate limit, and running live prices against mock rates is never what anyone meant.
   * An unrecognised value yields no rates at all rather than fabricated ones — see services/fx.
   */
  /**
   * Where index series for benchmark comparison come from. Defaults to the market-data provider,
   * which is where an index would live — but index data is not on Twelve Data's free tier, so a
   * deployment on one should set this to "mock" to get a deterministic synthetic series instead of
   * a permanently unavailable benchmark.
   */
  get benchmarkProvider() {
    return process.env.BENCHMARK_PROVIDER ?? process.env.MARKET_DATA_PROVIDER ?? "mock"
  },
  get fxProvider() {
    return process.env.FX_PROVIDER ?? process.env.MARKET_DATA_PROVIDER ?? "mock"
  },

  /** Bypasses RLS. Used only by the scheduled job, which must read every user's alerts. */
  get supabaseServiceRoleKey() {
    return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ""
  },
  /** Shared secret the cron endpoint checks before doing any work. */
  get cronSecret() {
    return process.env.CRON_SECRET ?? ""
  },
  get vapidPublicKey() {
    return process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""
  },
  get vapidPrivateKey() {
    return process.env.VAPID_PRIVATE_KEY ?? ""
  },
  /** A mailto: or https: URL identifying the sender, required by the Web Push spec. */
  get vapidSubject() {
    return process.env.VAPID_SUBJECT ?? "mailto:alerts@stockly.local"
  },
  get pushConfigured() {
    return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
  },

  // ---- AI (phase 7). The key is read here and nowhere else, so it cannot reach the browser.
  //
  // `aiEnabled` is a kill switch, not a convenience: with it false, no AI route does any work and
  // every other feature is untouched. That is what makes shipping with AI off a real option.
  get aiEnabled() {
    return process.env.AI_ENABLED === "true"
  },
  get aiProvider() {
    return process.env.AI_PROVIDER ?? "mock"
  },
  get aiApiKey() {
    return process.env.AI_API_KEY ?? ""
  },
  get aiModel() {
    return process.env.AI_MODEL ?? ""
  },
  get aiBaseUrl() {
    return process.env.AI_BASE_URL ?? ""
  },
  get aiMaxTokens() {
    return positiveInt(process.env.AI_MAX_TOKENS, 2000)
  },
  /**
   * Only the openai-compatible adapter sends this. Current Claude models reject sampling
   * parameters outright, so the anthropic adapter deliberately ignores it — see docs/AI.md.
   */
  get aiTemperature() {
    const parsed = Number(process.env.AI_TEMPERATURE)
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= 2 ? parsed : 0.2
  },
  get aiTimeoutMs() {
    return positiveInt(process.env.AI_TIMEOUT_MS, 25_000)
  },
  get aiDailyLimit() {
    return positiveInt(process.env.AI_DAILY_LIMIT, 25)
  },
}

