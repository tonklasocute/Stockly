import { z } from "zod"
import { ApiError, fail, guarded, ok, parseBody } from "@/lib/api"
import { invalidateIntelligence } from "@/lib/cache"
import { getBenchmarkProvider, listBenchmarks } from "@/services/benchmark"
import { createClient } from "@/lib/supabase/server"

/**
 * The benchmarks this deployment knows about, each with whether its data can actually be fetched.
 *
 * `available: false` is the common case on a free market-data plan — index series are not on one —
 * and the UI shows it rather than hiding the option, so a user who picks one understands why the
 * comparison then reads "N/A" instead of thinking the feature is broken.
 */
export async function GET() {
  return guarded(async () => {
    const benchmarks = await listBenchmarks()
    const provider = getBenchmarkProvider()

    const withAvailability = await Promise.all(
      benchmarks.map(async (benchmark) => ({
        ...benchmark,
        available: await provider.supports(benchmark).catch(() => false),
      })),
    )
    return ok({ benchmarks: withAvailability })
  })
}

const selectionSchema = z.object({
  portfolioId: z.uuid("Choose a portfolio."),
  /** Null clears the selection: a portfolio is allowed to have no benchmark. */
  benchmarkId: z.uuid().nullable(),
})

/**
 * Sets, changes or clears a portfolio's benchmark.
 *
 * One per portfolio, enforced by a unique constraint, so this upserts rather than accumulating
 * rows. The composite foreign key refuses a `portfolioId` the caller does not own, whatever the
 * body claims — the same protection every other write in the application relies on.
 */
export async function PUT(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, selectionSchema)
    const supabase = await createClient()

    if (body.benchmarkId === null) {
      const { error } = await supabase
        .from("portfolio_benchmarks")
        .delete()
        .eq("portfolio_id", body.portfolioId)
      if (error) throw error
      invalidateIntelligence()
      return ok({ benchmarkId: null })
    }

    const { data, error } = await supabase
      .from("portfolio_benchmarks")
      .upsert(
        { portfolio_id: body.portfolioId, user_id: userId, benchmark_id: body.benchmarkId },
        { onConflict: "portfolio_id" },
      )
      .select("*")
      .maybeSingle()

    if (error?.code === "23503") {
      throw new ApiError("VALIDATION_ERROR", "That benchmark does not exist.")
    }
    if (error) throw error
    if (!data) return fail("NOT_FOUND", "Portfolio not found.")

    invalidateIntelligence()
    return ok(data)
  })
}
