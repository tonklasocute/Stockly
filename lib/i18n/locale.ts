"use client"

import { useLocale } from "next-intl"
import { DEFAULT_LOCALE, toLocale, type Locale } from "@/domain/locale"

/**
 * The current language, as a `Locale` rather than as an `Intl` tag.
 *
 * next-intl is handed the Gregorian-pinned tag (`th-TH-u-ca-gregory`) so that every formatter it
 * owns gets the calendar right — see `lib/i18n/request.ts`. Code that needs the *identity* of the
 * language rather than a formatter for it — the switcher, a conditional label width, a settings
 * form — wants `"th"`, and this is the one place that conversion happens.
 */
export function useAppLocale(): Locale {
  return toLocale(useLocale().split("-")[0]) ?? DEFAULT_LOCALE
}

/** The tag to hand any `Intl` constructor on the client. Never build one by hand. */
export function useIntlTag(): string {
  return useLocale()
}
