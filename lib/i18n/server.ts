import "server-only"

import { getLocale } from "next-intl/server"
import { DEFAULT_LOCALE, toLocale, type Locale } from "@/domain/locale"

/**
 * The server-side counterpart of `useAppLocale`.
 *
 * Same conversion, same reason: next-intl holds the `Intl` tag, and a Server Component that needs
 * the language's identity — to pick a metadata block, to build an `hreflang`, to hand a locale to
 * `lib/format.ts` — needs the short code. Two functions rather than one shared module because the
 * client one is `"use client"` and this one is `server-only`; sharing them would defeat both.
 */
export async function appLocale(): Promise<Locale> {
  return toLocale((await getLocale()).split("-")[0]) ?? DEFAULT_LOCALE
}

/** The tag to hand any `Intl` constructor on the server. */
export async function serverIntlTag(): Promise<string> {
  return getLocale()
}
