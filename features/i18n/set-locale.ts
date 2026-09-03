"use client"

import {
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  type Locale,
} from "@/domain/locale"

/**
 * Remember a language choice, everywhere it needs to be remembered.
 *
 * Two writes, in this order and for two different lifetimes:
 *
 * 1. **The cookie**, synchronously. It is what the next server render reads, so it must be in place
 *    before the refresh — and writing it in the browser rather than through an endpoint means an
 *    anonymous visitor on a public share page can change language too, without an account and
 *    without a request that could fail.
 * 2. **The preference row**, when there is somebody to attach it to. This is the part that survives
 *    a new device. It is fire-and-forget on purpose: the language has already changed on screen,
 *    and a failed round trip should not undo that or raise a toast about it. The endpoint refuses
 *    anything but a supported locale, and takes the user from the session, never from the body.
 *
 * `SameSite=Lax` and no `Secure` in development. Not `HttpOnly`: the switcher has to be able to
 * write it, and a UI language is not a secret. The value is re-validated against the closed enum
 * on every read (`toLocale`), so the worst a hand-edited cookie achieves is the default language.
 */
export function rememberLocale(locale: Locale, { signedIn }: { signedIn: boolean }) {
  const secure = window.location.protocol === "https:" ? "; Secure" : ""
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`

  if (!signedIn) return
  void fetch("/api/preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale }),
  }).catch(() => {
    /* The choice is already in effect on this device; the sync is best-effort. */
  })
}
