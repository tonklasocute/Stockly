import { enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { createClient } from "@/lib/supabase/server"
import { aiScreenerSchema } from "@/features/ai/schema"
import { proposeScreen } from "@/features/ai/research-service"

/**
 * Natural language to screener filters.
 *
 * **This endpoint proposes; it never runs.** It returns a validated `{ metric, operator, value }`
 * definition for the user to review, and running it is a separate request to the existing
 * /api/screener endpoint. So a model cannot cause a query to execute, and every filter that does
 * execute went through the same closed enums a hand-built screen goes through.
 */
export const runtime = "nodejs"
export const maxDuration = 60

export async function POST(request: Request) {
  return guarded(async (userId) => {
    enforceRateLimit(`ai:screener:${userId}`, 6, 60)
    const body = await parseBody(request, aiScreenerSchema)
    const supabase = await createClient()
    return ok(await proposeScreen({ supabase, userId, query: body.query }))
  })
}
