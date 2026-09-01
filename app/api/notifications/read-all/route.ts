import { guarded, ok } from "@/lib/api"
import { invalidateAlerts } from "@/lib/cache"
import { createClient } from "@/lib/supabase/server"

export async function POST() {
  return guarded(async () => {
    const supabase = await createClient()
    // No user_id filter needed or wanted: RLS scopes the update to the caller's rows.
    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .is("read_at", null)
      .select("id")

    if (error) throw error
    invalidateAlerts()
    return ok({ marked: data?.length ?? 0 })
  })
}
