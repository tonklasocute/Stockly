import "server-only"

import { cookies, headers } from "next/headers"
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  LOCALE_PARAM,
  toLocale,
  type Locale,
} from "@/domain/locale"

/**
 * Which language this request is in.
 *
 * The chain, in order, and why it is this order:
 *
 *   1. **The cookie**, written by the language switcher. It is the user's most recent, most
 *      explicit statement about this device, and it costs nothing to read.
 *   2. **The signed-in user's stored preference**, consulted only when there is no cookie — which
 *      is to say once, on a device they have not used before. Reading it on every request instead
 *      would put a database round trip in front of every page render to answer a question the
 *      cookie has already answered.
 *   3. **`DEFAULT_LOCALE`** — Thai, by product decision rather than by `Accept-Language`. An
 *      anonymous visitor to a public share page lands here, and a share link is a page whose
 *      language its owner should be able to reason about.
 *
 * The deviation from a strict "database above cookie" ordering is deliberate and has one visible
 * consequence, documented in `docs/i18n.md`: changing the language on one device does not retune a
 * device that is already open. The switcher writes both, so the next device to sign in gets it.
 *
 * A cookie value is never trusted: `toLocale` is a closed-enum check, so a hand-edited cookie can
 * only ever produce the default. That is the whole of the locale attack surface.
 */
export async function resolveLocale(): Promise<Locale> {
  /*
   * The header the middleware set from `?lang=`, above everything else.
   *
   * It is only ever present on a shared route, and on those the visitor's URL is the most explicit
   * statement there is — more explicit than a cookie, which on those pages might belong to the
   * owner rather than the reader. This is what keeps `<html lang>` and the client message payload
   * agreeing with the server-rendered body.
   */
  const [store, requestHeaders] = await Promise.all([cookies(), headers()])

  const fromUrl = toLocale(requestHeaders.get(LOCALE_HEADER))
  if (fromUrl) return fromUrl

  const fromCookie = toLocale(store.get(LOCALE_COOKIE)?.value)
  if (fromCookie) return fromCookie

  const fromPreference = await storedLocale(store.getAll())
  if (fromPreference) return fromPreference

  return DEFAULT_LOCALE
}

/**
 * The signed-in user's stored language, or null.
 *
 * Guarded twice. The `sb-` check avoids an auth round trip for a request that plainly has no
 * session — every anonymous hit on a public share page — and the import is dynamic so that the
 * Supabase client is not pulled into a request that never needs it. Any failure returns null: a
 * language preference is not worth failing a page render over.
 */
async function storedLocale(all: { name: string }[]): Promise<Locale | null> {
  if (!all.some((cookie) => cookie.name.startsWith("sb-"))) return null

  try {
    const { loadPreferences } = await import("@/features/personalization/queries")
    return toLocale((await loadPreferences()).locale)
  } catch {
    return null
  }
}

/**
 * The language of a **public** page — a share link, a snapshot, a published portfolio.
 *
 * Deliberately a different function from `resolveLocale`, with a different first source, because
 * the reader is a different person. A visitor to `/p/acme` has no preference row and usually no
 * session, so the only thing they can say about their language is `?lang=`; and the owner's cookie
 * must never decide it, because the owner is not the one reading the page.
 *
 *   `?lang=` → this device's cookie → `DEFAULT_LOCALE`
 *
 * The parameter is validated by the same closed-enum check as everything else, so `?lang=<script>`
 * is not a locale and renders the default. It is never echoed into the page.
 */
export async function resolvePublicLocale(
  searchParams?: Record<string, string | string[] | undefined>,
): Promise<Locale> {
  const raw = searchParams?.[LOCALE_PARAM]
  const requested = toLocale(Array.isArray(raw) ? raw[0] : raw)
  if (requested) return requested

  /*
   * Falls through to `resolveLocale`, rather than repeating its chain.
   *
   * The two used to derive the answer separately, and the consequence was a document that declared
   * `lang="th"` while its body rendered in English. Deferring here means the page body, `<html
   * lang>` and the client message payload cannot disagree, because only one function decides.
   */
  return resolveLocale()
}
