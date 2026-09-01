import { ApiError, enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { savedScreenSchema } from "@/features/screener/schema"
import { createClient } from "@/lib/supabase/server"

const MAX_SAVED_SCREENS = 30

export async function GET() {
  return guarded(async () => {
    const supabase = await createClient()
    // RLS scopes this to the caller; no user_id filter in application code.
    const { data, error } = await supabase
      .from("saved_screens")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) throw error
    return ok({ screens: data ?? [] })
  })
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    enforceRateLimit(`screener:save:${userId}`, 20, 60)
    const body = await parseBody(request, savedScreenSchema)
    const supabase = await createClient()

    const { count } = await supabase.from("saved_screens").select("id", { count: "exact", head: true })
    if ((count ?? 0) >= MAX_SAVED_SCREENS) {
      throw new ApiError("CONFLICT", `You can save at most ${MAX_SAVED_SCREENS} screens.`)
    }

    const { data, error } = await supabase
      .from("saved_screens")
      .insert({
        user_id: userId, // from the session, never the body
        // Already parsed by Zod into the closed enum shape, and checked again by the table.
        name: body.name,
        definition: body.definition,
      })
      .select("*")
      .single()

    if (error?.code === "23505") throw new ApiError("CONFLICT", "You already have a screen with that name.")
    if (error) throw error
    return ok(data, 201)
  })
}
