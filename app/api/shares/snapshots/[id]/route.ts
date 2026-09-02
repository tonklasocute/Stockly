import { guarded, ok } from "@/lib/api"
import { invalidateSharing } from "@/lib/cache"
import { deleteSnapshot } from "@/features/sharing/publish"

/**
 * Deletes a snapshot.
 *
 * A snapshot is a rendered artefact, so deleting one removes a page and nothing else: no
 * transaction, no holding, no cost basis and no P&L is touched, because none of them was ever
 * derived from it.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guarded(async (userId) => {
    const { id } = await context.params
    await deleteSnapshot(id, userId)
    invalidateSharing(null, null)
    return ok({ deleted: true })
  })
}
