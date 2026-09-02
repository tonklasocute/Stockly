import { ApiError, enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { invalidateSharing } from "@/lib/cache"
import { createSnapshot } from "@/features/sharing/publish"
import { listSnapshots } from "@/features/sharing/queries"
import { createSnapshotSchema, MAX_SNAPSHOTS_PER_PORTFOLIO } from "@/features/sharing/schema"

export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "A portfolio is required.")
    return ok({ snapshots: await listSnapshots(portfolioId) })
  })
}

/**
 * Freezes the current projection.
 *
 * Runs the same engine, the same source builder and the same projector as the live page — a
 * snapshot is a rendering held still, never a second calculation. It is immutable once written:
 * `share_snapshots` has no update policy, so there is no route to editing a figure after the fact.
 */
export async function POST(request: Request) {
  return guarded(async (userId) => {
    // Same cost as publishing: a full analytics pass and a batched quote call.
    enforceRateLimit(`share-snapshot:${userId}`, 10, 60)
    const body = await parseBody(request, createSnapshotSchema)

    const existing = await listSnapshots(body.portfolioId)
    if (existing.length >= MAX_SNAPSHOTS_PER_PORTFOLIO) {
      throw new ApiError(
        "CONFLICT",
        `You can keep at most ${MAX_SNAPSHOTS_PER_PORTFOLIO} snapshots. Delete one to take another.`,
      )
    }

    const { token, id } = await createSnapshot(body.portfolioId, userId, body.label)
    invalidateSharing(null, null)
    return ok({ id, token }, 201)
  })
}
