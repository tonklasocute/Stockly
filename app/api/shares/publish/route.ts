import { z } from "zod"
import { enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { invalidateSharing } from "@/lib/cache"
import { publishShare } from "@/features/sharing/publish"
import { loadShare, toConfig } from "@/features/sharing/queries"

/**
 * Rebuilds the published document from today's figures.
 *
 * This exists because what a visitor sees is a **publication, not a live feed**. The owner's own
 * pages recompute on every render; a shared page serves the document that was last written, and it
 * prints when that was. Pressing this is how the two are brought back together.
 *
 * Rate-limited harder than a normal write: each call runs a full analytics pass and a batched quote
 * call, so it is the one endpoint in this feature that costs an upstream credit.
 */
export async function POST(request: Request) {
  return guarded(async (userId) => {
    // Ten a minute. Every call spends a batched quote request upstream, so this is the money brake
    // rather than the loop brake.
    enforceRateLimit(`share-publish:${userId}`, 10, 60)
    const { portfolioId } = await parseBody(request, z.object({ portfolioId: z.uuid() }))
    const config = toConfig(await loadShare(portfolioId))
    const result = await publishShare(portfolioId, userId)
    invalidateSharing(config.slug, config.slug)
    return ok(result)
  })
}
