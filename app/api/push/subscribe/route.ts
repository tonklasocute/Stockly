import { enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { pushSubscriptionSchema } from "@/features/alerts/schema"
import { createClient } from "@/lib/supabase/server"
import { isPushConfigured } from "@/services/notifications"

/**
 * Stores a browser's push subscription against the signed-in user.
 *
 * The endpoint is unique across the table, not per user: a device handed to someone else
 * re-subscribes with the same endpoint, and the row must move to the new owner rather than exist
 * twice. Without that, the previous owner would keep receiving alerts on a phone they no longer have.
 */
export async function POST(request: Request) {
  return guarded(async (userId) => {
    enforceRateLimit(`push:subscribe:${userId}`, 10, 60)
    const body = await parseBody(request, pushSubscriptionSchema)
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("push_subscriptions")
      .upsert(
        {
          user_id: userId,
          endpoint: body.endpoint,
          p256dh: body.keys.p256dh,
          auth: body.keys.auth,
          user_agent: body.userAgent ?? null,
          last_used_at: null,
        },
        { onConflict: "endpoint" },
      )
      .select("id")
      .single()

    if (error) throw error
    return ok({ id: data.id, pushConfigured: isPushConfigured() }, 201)
  })
}
