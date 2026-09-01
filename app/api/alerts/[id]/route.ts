import { fail, guarded, ok, parseBody } from "@/lib/api"
import { invalidateAlerts } from "@/lib/cache"
import { alertUpdateSchema } from "@/features/alerts/schema"
import { createClient } from "@/lib/supabase/server"

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Ctx) {
  return guarded(async () => {
    const body = await parseBody(request, alertUpdateSchema)
    const { id } = await params
    const supabase = await createClient()

    // RLS scopes this to the caller: another user's alert id updates zero rows and 404s. The
    // authorization is the policy, not this handler.
    const { data, error } = await supabase
      .from("alerts")
      .update({
        ...(body.targetValue !== undefined ? { target_value: body.targetValue } : {}),
        ...(body.cooldownMinutes !== undefined ? { cooldown_minutes: body.cooldownMinutes } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        // Changing the threshold invalidates the stored crossing state: the old "triggered" was
        // about a different target, and keeping it would suppress the first real crossing.
        ...(body.targetValue !== undefined ? { state: "armed" as const, last_value: null } : {}),
      })
      .eq("id", id)
      .select("*")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Alert not found.")
    invalidateAlerts()
    return ok(data)
  })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  return guarded(async () => {
    const { id } = await params
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("alerts")
      .delete()
      .eq("id", id)
      .select("id")
      .maybeSingle()

    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Alert not found.")
    invalidateAlerts()
    return ok({ id: data.id })
  })
}
