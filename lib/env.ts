/**
 * Read env through here, never `process.env` directly, so a missing variable fails with a message
 * that names it instead of a downstream "undefined is not a string".
 *
 * Deliberately lazy: `next build` runs without secrets present, so validation happens on first use.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    )
  }
  return value
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL)
  },
  get supabaseAnonKey() {
    return required("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  },
  get marketDataProvider() {
    return process.env.MARKET_DATA_PROVIDER ?? "mock"
  },
}

/** True once Supabase is configured; lets pages render a setup hint instead of crashing. */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
