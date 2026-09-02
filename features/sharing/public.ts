import "server-only"

import { cache } from "react"
import type { PublicPortfolio } from "@/domain/sharing"
import { hashShareToken, looksLikeShareToken } from "@/lib/share-token"
import { createClient } from "@/lib/supabase/server"

/**
 * Everything an anonymous visitor can reach, and nothing else.
 *
 * Three entry points, one shape of answer, and one rule they all obey: **a request that is not
 * allowed returns `null`, and every reason for that is the same `null`.** A private portfolio, a
 * revoked link, an expired link, a snapshot that was deleted and an address that never existed are
 * indistinguishable from outside. The page turns that into "this is not available"; it never says
 * which of those it was, because "wrong token" and "revoked token" are different sentences only to
 * somebody probing.
 *
 * These functions run under the anonymous Supabase role. That role can read exactly one column of
 * one table — `published_shares` where visibility is PUBLIC — plus two `security definer` functions
 * that require a token. There is no path from here to a transaction, and no service-role client is
 * imported anywhere in this feature.
 */

export type SharedView = {
  portfolio: PublicPortfolio
  /** When the owner last published. A live figure this is not, and the page says so. */
  publishedAt: string
  kind: "PUBLIC" | "LINK"
  /** Whether a crawler may index this page. False for everything reached through a token. */
  indexable: boolean
}

export type SharedSnapshot = {
  portfolio: PublicPortfolio
  label: string | null
  version: number
  calculatedAt: string
  createdAt: string
}

/**
 * A payload is a document this codebase wrote, read back from jsonb.
 *
 * Checked structurally rather than trusted: a row written by an older version of the projector is
 * a real possibility, and rendering `undefined.sections` would take the page down rather than
 * degrade it. Not a Zod parse — the document is ours and the cost would be paid on every view of
 * every shared page; this is the narrow "is it the right shape" that the renderer actually needs.
 */
function asPublicPortfolio(payload: unknown): PublicPortfolio | null {
  if (typeof payload !== "object" || payload === null) return null
  const candidate = payload as Partial<PublicPortfolio>
  if (typeof candidate.displayName !== "string") return null
  if (typeof candidate.sections !== "object" || candidate.sections === null) return null
  return candidate as PublicPortfolio
}

/**
 * A public address. Only PUBLIC rows are visible to the anonymous role; RLS decides, not this code.
 *
 * `cache()`d because a page and its `generateMetadata` both need it, and a shared link arriving
 * from social media should cost one query rather than two.
 */
export const readPublicShare = cache(async (slug: string): Promise<SharedView | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("published_shares")
    .select("payload, published_at, allow_search_indexing")
    .eq("slug", slug)
    .eq("visibility", "PUBLIC")
    .maybeSingle()

  if (error) throw error
  const portfolio = data ? asPublicPortfolio(data.payload) : null
  if (!data || !portfolio) return null
  return {
    portfolio,
    publishedAt: data.published_at,
    kind: "PUBLIC",
    indexable: data.allow_search_indexing,
  }
})

/**
 * A share link.
 *
 * The token never reaches the database — its SHA-256 does — and the expiry and revocation checks
 * happen inside the definer function, in the same statement that reads the row, so there is no
 * window between "is this link valid" and "here is the portfolio".
 */
export async function readSharedByToken(token: string): Promise<SharedView | null> {
  if (!looksLikeShareToken(token)) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("share_by_token", { p_token_hash: hashShareToken(token) })

  if (error) throw error
  const row = data?.[0]
  const portfolio = row ? asPublicPortfolio(row.payload) : null
  if (!row || !portfolio) return null
  // Never indexable, whatever the share settings say: a link is a capability, and a capability in
  // a search result is not a capability any more.
  return { portfolio, publishedAt: row.published_at, kind: "LINK", indexable: false }
}

/** A frozen snapshot. Reachable by its own token whether or not the portfolio is shared at all. */
export async function readSnapshotByToken(token: string): Promise<SharedSnapshot | null> {
  if (!looksLikeShareToken(token)) return null
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("snapshot_by_token", { p_token_hash: hashShareToken(token) })

  if (error) throw error
  const row = data?.[0]
  const portfolio = row ? asPublicPortfolio(row.payload) : null
  if (!row || !portfolio) return null
  return {
    portfolio,
    label: row.label,
    version: row.version,
    calculatedAt: row.calculated_at,
    createdAt: row.created_at,
  }
}
