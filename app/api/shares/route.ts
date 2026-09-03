import { applyTemplate, DEFAULT_SHARE_CONFIG, type ShareConfig } from "@/domain/sharing"
import { ApiError, enforceRateLimit, guarded, ok, parseBody } from "@/lib/api"
import { invalidateSharing } from "@/lib/cache"
import { publishShare, recordEvent } from "@/features/sharing/publish"
import {
  listShareEvents,
  listShareLinks,
  listSnapshots,
  loadPublished,
  loadShare,
  slugAvailable,
  toConfig,
  toRow,
} from "@/features/sharing/queries"
import { applyTemplateSchema, shareConfigSchema } from "@/features/sharing/schema"
import { createClient } from "@/lib/supabase/server"

/**
 * The owner's sharing configuration.
 *
 * Every route here is authenticated and scoped by RLS; the public pages read `published_shares`
 * directly and never touch this file. `portfolioId` arrives in the body but is never trusted: the
 * composite foreign key on `portfolio_shares` means a row cannot be written against a portfolio the
 * session does not own, whatever the request claims.
 */
export async function GET(request: Request) {
  return guarded(async () => {
    const portfolioId = new URL(request.url).searchParams.get("portfolioId")
    if (!portfolioId) throw new ApiError("VALIDATION_ERROR", "A portfolio is required.", "portfolioRequired")

    const [row, links, snapshots, published, events] = await Promise.all([
      loadShare(portfolioId),
      listShareLinks(portfolioId),
      listSnapshots(portfolioId),
      loadPublished(portfolioId),
      listShareEvents(portfolioId),
    ])

    return ok({
      config: toConfig(row),
      settingsVersion: row?.settings_version ?? null,
      links,
      snapshots,
      published: published
        ? { publishedAt: published.published_at, settingsVersion: published.settings_version }
        : null,
      events,
    })
  })
}

/**
 * Saves the settings and republishes in the same request.
 *
 * The two are one action deliberately. Leaving a published document behind after the owner has
 * withdrawn a section would mean the page and the settings disagree, and the person harmed by that
 * gap is the one who just tried to close it.
 */
export async function PUT(request: Request) {
  return guarded(async (userId) => {
    // Saving republishes, which costs a quote call.
    enforceRateLimit(`share-config:${userId}`, 20, 60)
    const body = await parseBody(request, shareConfigSchema)
    const supabase = await createClient()

    if (body.slug && !(await slugAvailable(body.slug, body.portfolioId))) {
      throw new ApiError("CONFLICT", "That public address is already taken.", "duplicateSlug")
    }

    const existing = await loadShare(body.portfolioId)
    const before = toConfig(existing)
    const config: ShareConfig = { ...DEFAULT_SHARE_CONFIG, ...body }

    const { error } = await supabase.from("portfolio_shares").upsert(
      {
        portfolio_id: body.portfolioId,
        user_id: userId, // from the session, never the body
        ...toRow(config),
        // Bumped on every save, so a published document can be compared against the settings that
        // produced it without diffing two jsonb blobs.
        settings_version: (existing?.settings_version ?? 0) + 1,
      },
      { onConflict: "portfolio_id" },
    )

    if (error?.code === "23505") throw new ApiError("CONFLICT", "That public address is already taken.", "duplicateSlug")
    // A check constraint fired: the database restating a rule the schema also checks.
    if (error?.code === "23514") throw new ApiError("VALIDATION_ERROR", "Those settings are not allowed together.", "settingsIncompatible")
    if (error) throw error

    if (before.visibility !== config.visibility) {
      await recordEvent(body.portfolioId, userId, "VISIBILITY_CHANGED", {
        from: before.visibility,
        to: config.visibility,
      })
    } else {
      await recordEvent(body.portfolioId, userId, "SETTINGS_CHANGED", {})
    }

    const result = await publishShare(body.portfolioId, userId)
    invalidateSharing(before.slug, config.slug)
    return ok({ config, ...result })
  })
}

/** Applies a preset and saves it. The owner then edits it like any other configuration. */
export async function PATCH(request: Request) {
  return guarded(async (userId) => {
    const body = await parseBody(request, applyTemplateSchema)
    const supabase = await createClient()

    const current = toConfig(await loadShare(body.portfolioId))
    const config = applyTemplate(current, body.template)

    const { error } = await supabase.from("portfolio_shares").upsert(
      { portfolio_id: body.portfolioId, user_id: userId, ...toRow(config) },
      { onConflict: "portfolio_id" },
    )
    if (error) throw error

    await recordEvent(body.portfolioId, userId, "SETTINGS_CHANGED", { template: body.template })
    const result = await publishShare(body.portfolioId, userId)
    invalidateSharing(current.slug, config.slug)
    return ok({ config, ...result })
  })
}
