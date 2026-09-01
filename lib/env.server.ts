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
}
