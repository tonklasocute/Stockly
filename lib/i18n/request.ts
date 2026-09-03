import { getRequestConfig } from "next-intl/server"
import { intlTag, toLocale, type Locale } from "@/domain/locale"
import { logger } from "@/lib/log"
import { resolveLocale } from "./resolve"

/**
 * The next-intl entry point, wired up by `createNextIntlPlugin` in `next.config.ts`.
 *
 * Stockly runs next-intl **without locale routing**: there is no `[locale]` segment and no URL
 * changes. The reason is that this application's routing already carries four things that a path
 * prefix would have to be reconciled with — the CSP nonce that requires every route to be
 * server-rendered, share and snapshot tokens, the service worker's scope, and `robots.ts` /
 * `sitemap.ts`. A language is a preference, not an address, and treating it as one keeps every URL
 * in the application exactly where phases 1–20 put it.
 *
 * `timeZone` is deliberately absent. Locale and timezone are separate concerns (a Thai reader in
 * New York is a real user), and every date this application renders is either a calendar date with
 * no time at all or is formatted in the market's own timezone by `domain/calendar.ts`. Letting
 * next-intl impose one would be the localization layer quietly deciding when a trading day ended.
 */
export default getRequestConfig(async ({ locale: requested }) => {
  /*
   * An explicitly requested locale wins over the cookie.
   *
   * `getTranslations({ locale })` passes one, and the only caller that does is the shared-page
   * view — which is read by somebody who is not the owner, at a `?lang=` of their choosing. Without
   * this line their request would be answered in the *owner's* language, silently, and only on the
   * pages where getting it wrong matters most.
   */
  const locale = toLocale(requested) ?? (await resolveLocale())

  return {
    /*
     * The full BCP-47 tag, not the bare code.
     *
     * next-intl hands whatever is here straight to `Intl`, and `th` alone resolves to the Buddhist
     * calendar — the same trade date would read 2569 in Thai and 2026 in English. Pinning
     * `-u-ca-gregory` here means even a formatter somebody adds later, without reading
     * `lib/format.ts`, gets the era right. `useAppLocale()` recovers the short code for the code
     * that needs an identity rather than a formatter.
     */
    locale: intlTag(locale),
    // Only the active locale is imported, so a Thai page never ships the English messages.
    messages: (await load(locale)).default,
    /*
     * Missing keys: loud in development, harmless in production.
     *
     * A thrown error would take a page down over a label. A silently rendered blank would hide the
     * gap until a user found it. So production renders the key path — which is ugly, obviously
     * wrong, and greppable — while development throws it into the log where the person who just
     * added the key will see it. `lib/i18n/completeness.test.ts` is what actually stops one
     * reaching production; this is the net under it.
     */
    onError(error) {
      if (process.env.NODE_ENV === "production") logger.warn("i18n.message", { code: error.code })
      else console.error(error)
    },
    getMessageFallback({ namespace, key }) {
      return namespace ? `${namespace}.${key}` : key
    },
    formats: {
      dateTime: {
        short: { year: "numeric", month: "short", day: "2-digit" },
        long: { year: "numeric", month: "long", day: "numeric" },
      },
    },
  }
})

function load(locale: Locale) {
  return locale === "th" ? import("@/locales/th") : import("@/locales/en")
}
