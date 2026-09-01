import { cookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"
import { env } from "@/lib/env"
import type { Database } from "@/types/database"

/** Request-scoped client. Every query it makes runs under the caller's RLS policies. */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The middleware refreshes
          // the session, so dropping the write here is safe.
        }
      },
    },
  })
}

/** The signed-in user, or null. Always verified against the auth server, never read from a cookie. */
export async function getUser() {
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  return data.user
}
