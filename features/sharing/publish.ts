import "server-only"

import { projectPublicPortfolio, SNAPSHOT_VERSION, type ShareConfig } from "@/domain/sharing"
import { loadIntelligence } from "@/features/intelligence/loader"
import { toShareSource } from "@/features/sharing/source"
import { toConfig, loadShare } from "@/features/sharing/queries"
import { readPortfolioName } from "@/features/sharing/portfolio-name"
import { ApiError } from "@/lib/api"
import { logger } from "@/lib/log"
import { createShareToken } from "@/lib/share-token"
import { createClient } from "@/lib/supabase/server"
import type { ShareEventAction } from "@/types/database"

/**
 * Producing the document a visitor reads.
 *
 * Publishing is an explicit act by the owner, and everything downstream of it is a consequence of
 * that one decision:
 *
 * - The projection runs **as the owner**, under their session and their RLS. There is no privileged
 *   read anywhere in the sharing feature, so no request path can reach a portfolio that is not the
 *   caller's.
 * - What lands in `published_shares` is already filtered. The anonymous SELECT policy on that table
 *   therefore exposes a page, not a portfolio, and a mistake in this file can leak at most what the
 *   owner asked to publish.
 * - Republishing overwrites in place, so a stale document cannot outlive a settings change, and
 *   turning sharing off **deletes** the row rather than flagging it — there is then nothing left to
 *   serve by accident.
 */

/** The projected document plus the metadata a page needs beside it. */
export async function buildProjection(portfolioId: string, config: ShareConfig) {
  const [bundle, name] = await Promise.all([
    loadIntelligence(portfolioId),
    readPortfolioName(portfolioId),
  ])
  if (name === null) throw new ApiError("NOT_FOUND", "That portfolio does not exist.")

  const source = toShareSource(bundle, name)
  return { payload: projectPublicPortfolio(source, config), baseCurrency: bundle.baseCurrency }
}

/**
 * Writes the published document, or removes it when the portfolio is private.
 *
 * Returns what the owner is told: whether anything is now reachable, and from where.
 */
export async function publishShare(
  portfolioId: string,
  userId: string,
): Promise<{ published: boolean; slug: string | null }> {
  const supabase = await createClient()
  const row = await loadShare(portfolioId)
  const config = toConfig(row)

  if (config.visibility === "PRIVATE" || config.slug === null) {
    const { error } = await supabase.from("published_shares").delete().eq("portfolio_id", portfolioId)
    if (error) throw error
    await recordEvent(portfolioId, userId, "UNPUBLISHED", { visibility: config.visibility })
    return { published: false, slug: null }
  }

  /*
   * **Fails closed.**
   *
   * If the projection cannot be built — a market-data outage, a portfolio that vanished — the
   * previously published document is *removed* rather than left standing. The dangerous case is
   * specific and worth stating: an owner switches a section off, the settings save, the rebuild
   * then fails, and a public page keeps showing what they just withdrew. A page that is
   * temporarily unavailable is a far better outcome than one that is quietly out of date about
   * privacy.
   */
  let payload
  try {
    ;({ payload } = await buildProjection(portfolioId, config))
  } catch (error) {
    await supabase.from("published_shares").delete().eq("portfolio_id", portfolioId)
    logger.warn("share.publish_failed", {
      message: error instanceof Error ? error.message : "unknown",
    })
    throw error
  }

  const { error } = await supabase.from("published_shares").upsert(
    {
      portfolio_id: portfolioId,
      slug: config.slug,
      visibility: config.visibility,
      allow_search_indexing: config.allowSearchIndexing,
      payload,
      settings_version: row?.settings_version ?? 1,
      published_at: new Date().toISOString(),
    },
    { onConflict: "portfolio_id" },
  )
  if (error) throw error

  await recordEvent(portfolioId, userId, "PUBLISHED", {
    visibility: config.visibility,
    sections: Object.keys(payload.sections).length,
  })
  // Counters and a visibility. Never the slug's traffic, never a figure from the document.
  logger.info("share.published", {
    visibility: config.visibility,
    sections: Object.keys(payload.sections).length,
  })

  return { published: true, slug: config.slug }
}

/**
 * Issues a share link.
 *
 * The raw token is returned to this one caller and never stored, never logged, and never included
 * in an audit row. If the owner loses it, they revoke the link and create another — which is the
 * correct outcome, because a system that can show it again is a system that stored it.
 */
export async function createShareLink(
  portfolioId: string,
  userId: string,
  input: { label: string | null; expiresAt: string | null },
): Promise<{ token: string; id: string }> {
  const supabase = await createClient()
  const { token, hash } = createShareToken()

  const { data, error } = await supabase
    .from("portfolio_share_links")
    .insert({
      portfolio_id: portfolioId,
      user_id: userId,
      token_hash: hash,
      label: input.label,
      expires_at: input.expiresAt,
    })
    .select("id")
    .single()

  if (error) throw error
  await recordEvent(portfolioId, userId, "LINK_CREATED", { label: input.label, expires: input.expiresAt })
  return { token, id: data.id }
}

/**
 * Revokes a link.
 *
 * A timestamp rather than a delete, so the owner keeps the record that the link existed and when
 * they closed it. `share_by_token` checks `revoked_at` on every read, so the effect is immediate —
 * there is no cached answer to outlive it, because a link page is never cached.
 */
export async function revokeShareLink(linkId: string, userId: string): Promise<void> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("portfolio_share_links")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", linkId)
    .is("revoked_at", null)
    .select("portfolio_id")
    .maybeSingle()

  if (error) throw error
  // RLS turned somebody else's link into no rows. A 404 rather than a 403: confirming that an id
  // exists is itself information.
  if (!data) throw new ApiError("NOT_FOUND", "That share link does not exist.")
  await recordEvent(data.portfolio_id, userId, "LINK_REVOKED", {})
}

/**
 * Freezes the current projection.
 *
 * A snapshot is built from the same engine and the same projector as the live page — it is a
 * *rendering* held still, not a second calculation. Its payload is written once and there is no
 * update policy on the table, so what a snapshot says on the day it was taken is what it says
 * forever.
 */
export async function createSnapshot(
  portfolioId: string,
  userId: string,
  label: string | null,
): Promise<{ token: string; id: string }> {
  const supabase = await createClient()
  const config = toConfig(await loadShare(portfolioId))
  const { payload, baseCurrency } = await buildProjection(portfolioId, config)
  const { token, hash } = createShareToken()

  const { data, error } = await supabase
    .from("share_snapshots")
    .insert({
      portfolio_id: portfolioId,
      user_id: userId,
      token_hash: hash,
      version: SNAPSHOT_VERSION,
      label,
      base_currency: baseCurrency,
      calculated_at: payload.calculatedAt,
      payload,
    })
    .select("id")
    .single()

  if (error) throw error
  await recordEvent(portfolioId, userId, "SNAPSHOT_CREATED", { snapshotId: data.id })
  return { token, id: data.id }
}

export async function deleteSnapshot(snapshotId: string, userId: string): Promise<void> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("share_snapshots")
    .delete()
    .eq("id", snapshotId)
    .select("portfolio_id")
    .maybeSingle()

  if (error) throw error
  if (!data) throw new ApiError("NOT_FOUND", "That snapshot does not exist.")
  await recordEvent(data.portfolio_id, userId, "SNAPSHOT_DELETED", { snapshotId })
}

/**
 * The audit trail: what the owner did to their own sharing settings.
 *
 * Deliberately one-sided. It records decisions, never viewers — no address, no user agent, no
 * referrer, no geography. "Who looked at my portfolio" is a question Stockly chooses not to be able
 * to answer, and a share link's counter is the whole of what it will say.
 *
 * A failure here is logged and swallowed: losing an audit row must not fail the action it describes.
 */
export async function recordEvent(
  portfolioId: string,
  userId: string,
  action: ShareEventAction,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    const supabase = await createClient()
    const { error } = await supabase
      .from("share_events")
      .insert({ portfolio_id: portfolioId, user_id: userId, action, detail })
    if (error) logger.warn("share.audit_write_failed", { action, code: error.code })
  } catch (error) {
    logger.warn("share.audit_write_failed", {
      action,
      message: error instanceof Error ? error.message : "unknown",
    })
  }
}
