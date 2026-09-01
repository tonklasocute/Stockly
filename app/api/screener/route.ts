import { enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { screenerRunSchema } from "@/features/screener/schema"
import { runScreener } from "@/features/screener/run"
import { SCREENER_PRESETS } from "@/domain/screener"

/** The presets, so the client renders exactly what the server would run. */
export async function GET() {
  return guarded(async () => ok({ presets: SCREENER_PRESETS }))
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    // Running a screen is a database read, not an upstream call, but it is still work.
    enforceRateLimit(`screener:run:${userId}`, 30, 60)

    const body = await parseBody(request, screenerRunSchema)
    return ok(await runScreener(body.definition, body.page))
  })
}
