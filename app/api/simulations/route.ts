import { ApiError, guarded, ok, parseBody } from "@/lib/api"
import { invalidateSimulations } from "@/lib/cache"
import { listSimulations } from "@/features/simulations/queries"
import { MAX_SAVED_SIMULATIONS, savedSimulationSchema } from "@/features/simulations/schema"
import { createClient } from "@/lib/supabase/server"

/**
 * Saved scenarios.
 *
 * There is **no endpoint that runs a simulation**, and that is the design rather than an omission:
 * every calculation in `domain/simulation` is pure and deterministic, so it runs in the browser as
 * a slider moves. A round trip per keystroke would add latency to arithmetic and a second place for
 * the formula to live. Only persistence needs a server.
 */
export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId") ?? undefined
    return ok({ simulations: await listSimulations(portfolioId) })
  })
}

export async function POST(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, savedSimulationSchema)
    const supabase = await createClient()

    // A cap the database can answer, unlike an in-memory counter a cold start forgets.
    const { count } = await supabase
      .from("saved_simulations")
      .select("id", { count: "exact", head: true })
    if ((count ?? 0) >= MAX_SAVED_SIMULATIONS) {
      throw new ApiError(
        "CONFLICT",
        `You can save at most ${MAX_SAVED_SIMULATIONS} scenarios. Delete one to add another.`,
      )
    }

    const { data, error } = await supabase
      .from("saved_simulations")
      .insert({
        user_id: userId, // from the session, never the body
        portfolio_id: body.portfolioId,
        name: body.name,
        type: body.type,
        // Inputs only. Nothing a simulation produces is stored, so a saved scenario cannot go stale.
        inputs: body.inputs,
      })
      .select("*")
      .single()

    if (error?.code === "23505") {
      throw new ApiError("CONFLICT", "You already have a scenario with that name.", "duplicateScenarioName")
    }
    if (error?.code === "23514" || error?.code === "23503") {
      throw new ApiError("VALIDATION_ERROR", "That scenario violates a data rule.", "dataRuleScenario")
    }
    if (error) throw error

    invalidateSimulations()
    return ok(data, 201)
  })
}
