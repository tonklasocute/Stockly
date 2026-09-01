import "server-only"

import { createClient } from "@supabase/supabase-js"
import { env } from "@/lib/env"
import { serverEnv } from "@/lib/env.server"
import type { Database } from "@/types/database"

/**
 * Service-role client. **Bypasses RLS entirely.**
 *
 * Exactly one caller is legitimate: the scheduled alert job, which has to read alerts belonging to
 * every user and has no session to act under. Anything reachable from a request must use the
 * request-scoped client in `server.ts` so RLS still applies.
 */
export function createAdminClient() {
  const key = serverEnv.supabaseServiceRoleKey
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. The scheduled alert job cannot run without it.",
    )
  }
  return createClient<Database>(env.supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
