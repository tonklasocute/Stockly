import { guarded, ok, parseBody } from "@/lib/api"
import { invalidateAlerts } from "@/lib/cache"
import { notificationPreferencesSchema } from "@/features/alerts/schema"
import { getPreferences } from "@/features/notifications/queries"
import { createClient } from "@/lib/supabase/server"

export async function GET() {
  return guarded(async () => ok({ preferences: await getPreferences() }))
}

export async function PUT(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, notificationPreferencesSchema)
    const supabase = await createClient()

    // Upsert: the trigger creates a row at sign-up, but a user created before this migration
    // would not have one.
    const { data, error } = await supabase
      .from("notification_preferences")
      .upsert({ user_id: userId, ...body }, { onConflict: "user_id" })
      .select("*")
      .single()

    if (error) throw error
    invalidateAlerts()
    return ok(data)
  })
}
