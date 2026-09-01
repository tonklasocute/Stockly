import { fail, guarded, ok } from "@/lib/api"
import { invalidateAlerts } from "@/lib/cache"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

/** Marks one notification read. RLS is what stops this touching anyone else's row. */
export async function PATCH(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Notification not found.")
    invalidateAlerts()
    return ok({ id: data.id })
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("notifications")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Notification not found.")
    invalidateAlerts()
    return ok({ id: data.id })
  })
}
