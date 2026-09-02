import { guarded, ok } from "@/lib/api"
import { invalidateSharing } from "@/lib/cache"
import { revokeShareLink } from "@/features/sharing/publish"

/**
 * Revokes a link. Immediate, with nothing cached in front of it: a link page is rendered per
 * request precisely so that this takes effect on the next one.
 *
 * A link belonging to somebody else is a 404, not a 403 — telling a caller that an id exists but is
 * not theirs is information they did not have.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return guarded(async (userId) => {
    const { id } = await context.params
    await revokeShareLink(id, userId)
    invalidateSharing(null, null)
    return ok({ revoked: true })
  })
}
