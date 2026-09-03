/**
 * Language: the registry, and nothing else.
 *
 * The boundary is the same one `domain/personalization.ts` draws, and it runs one way:
 *
 *   **A locale decides what a number is called. It can never decide what the number is.**
 *
 * There is no figure in this file, no translation, no formatter and no `Intl` call. A locale is an
 * identifier, a label and a BCP-47 tag — the smallest thing that can travel from a cookie, through
 * a request, into a formatter, without any of the three importing each other.
 * `domain/locale-boundary.test.ts` asserts the whole i18n layer cannot move a financial figure.
 *
 * Pure: this module imports nothing at all, deliberately. The day it needs an import is the day to
 * ask whether a calculation is creeping into a presentation concern.
 */

/**
 * The locales Stockly ships.
 *
 * Adding one is a member here, its `LOCALE_META` row, and a directory under `locales/`. Nothing
 * else in the application changes — no domain function, no route, no component — which is the
 * property this file exists to preserve. `ja`, `zh` and `ko` are the next candidates and need no
 * architectural change.
 */
export const SUPPORTED_LOCALES = ["th", "en"] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export type SupportedLocale = Locale

/**
 * Thai, per the product decision, not per the browser.
 *
 * The chain that leads here is in `lib/i18n/resolve.ts`; this is only its floor. It is also the
 * locale an anonymous visitor to a public share page gets, which is why it must be a decision
 * somebody made rather than whatever `Accept-Language` happened to say.
 */
export const DEFAULT_LOCALE: Locale = "th"

/**
 * What a locale is called, and how `Intl` should be asked for it.
 *
 * `intlTag` is deliberately **not** the bare locale code. `th-TH` resolves to the Buddhist calendar
 * in ICU, so a trade date recorded on 2026-09-03 would render as 2569 in Thai and 2026 in English —
 * the same transaction, two years, in an application whose entire premise is that a figure means
 * one thing. `-u-ca-gregory` pins the era; the month names stay Thai. See `docs/i18n.md`.
 *
 * `label` is written in its own language on purpose: somebody who has accidentally switched to a
 * language they cannot read must still be able to find their way back.
 */
export const LOCALE_META: Record<Locale, { label: string; short: string; intlTag: string }> = {
  th: { label: "ไทย", short: "TH", intlTag: "th-TH-u-ca-gregory" },
  en: { label: "English", short: "EN", intlTag: "en-US" },
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** A candidate from a cookie, a query string or a preference row — anything or nothing. */
export function toLocale(value: unknown): Locale | null {
  return isLocale(value) ? value : null
}

/**
 * The BCP-47 tag every `Intl` constructor in the application is given.
 *
 * One function, so the Buddhist-calendar decision above is made once and cannot be forgotten by
 * the next formatter somebody adds.
 */
export function intlTag(locale: Locale): string {
  return LOCALE_META[locale].intlTag
}

/**
 * The first supported locale in a preference list, or null.
 *
 * Written for `Accept-Language` even though the resolver does not currently consult it: the header
 * is the obvious next source somebody will want, and parsing it in the pure module is what keeps
 * that change from becoming a second place that decides what a locale is.
 */
export function matchLocale(candidates: readonly string[]): Locale | null {
  for (const candidate of candidates) {
    const base = candidate.split("-")[0]?.toLowerCase()
    if (isLocale(base)) return base
  }
  return null
}

/** The cookie the language switcher writes and the request resolver reads. */
export const LOCALE_COOKIE = "stockly_locale"

/** The query parameter a public share page accepts, since a visitor has no preference row. */
export const LOCALE_PARAM = "lang"

/** How long the locale cookie lives: a year, refreshed on every change. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/**
 * The request header the middleware uses to carry a URL-chosen language.
 *
 * A shared page takes its language from `?lang=`, but `<html lang>` and the client message payload
 * are decided in the **root layout**, which has no access to a route's search parameters. So the
 * middleware — which sees the whole URL — puts the answer here, and the resolver reads it first.
 * Without this the document declared one language while its body rendered in another: a screen
 * reader would read English prose in a Thai voice, and any client component on the page would
 * render from the wrong message set.
 */
export const LOCALE_HEADER = "x-stockly-locale"

/**
 * The routes on which `?lang=` decides the language of the whole document.
 *
 * Only the pages a stranger reads. Inside the application a language is a preference, and letting
 * a query parameter override it there would mean any link could silently change what somebody sees
 * without their preference changing — and would make the cookie and the URL two sources of truth.
 */
export const PUBLIC_LOCALE_ROUTES = ["/p/", "/share/", "/snapshot/"] as const

export function acceptsLocaleParam(pathname: string): boolean {
  return PUBLIC_LOCALE_ROUTES.some((prefix) => pathname.startsWith(prefix))
}
