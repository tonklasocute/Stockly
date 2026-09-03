import { expiryFor, type LinkDuration } from "@/domain/sharing"
import { ApiError, enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { invalidateSharing } from "@/lib/cache"
import { createShareLink } from "@/features/sharing/publish"
import { listShareLinks } from "@/features/sharing/queries"
import { createLinkSchema, MAX_LINKS_PER_PORTFOLIO } from "@/features/sharing/schema"

export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "A portfolio is required.", "portfolioRequired")
    return ok({ links: await listShareLinks(portfolioId) })
  })
}

/**
 * Issues a link.
 *
 * **The raw token is in this response and nowhere else.** It is not stored, not logged and not
 * recoverable — the database holds only its SHA-256. An owner who loses it revokes the link and
 * creates another, which is the honest consequence of storing a hash rather than a secret.
 */
export async function POST(request: Request) {
  return guarded(async (userId) => {
    enforceRateLimit(`share-link:${userId}`, 20, 60)
    const body = await parseBody(request, createLinkSchema)

    // A count, not a memory counter: a cap that a cold start forgets is not a cap.
    const existing = await listShareLinks(body.portfolioId)
    if (existing.filter((link) => link.revoked_at === null).length >= MAX_LINKS_PER_PORTFOLIO) {
      throw new ApiError(
        "CONFLICT",
        `You can have at most ${MAX_LINKS_PER_PORTFOLIO} active links. Revoke one to create another.`,
      )
    }

    const { token, id } = await createShareLink(body.portfolioId, userId, {
      label: body.label,
      expiresAt: expiryFor(body.duration as LinkDuration, new Date()),
    })

    invalidateSharing(null, null)
    return ok({ id, token }, 201)
  })
}
