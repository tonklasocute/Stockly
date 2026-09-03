import type { MetadataRoute } from "next"
import { getTranslations } from "next-intl/server"
import { appLocale } from "@/lib/i18n/server"

/**
 * The manifest, in the language the request asked for.
 *
 * A manifest is fetched once, by the browser, at install time — so this is the name that ends up
 * under the icon on somebody's home screen, and it should be in the language they were reading when
 * they installed it. `lang` and `dir` are declared so the install prompt renders the name correctly
 * even before the app runs.
 *
 * The route is excluded from the middleware matcher and cached for an hour by `next.config.ts`.
 * That cache is public and shared, so a manifest is not a place to put anything user-specific —
 * only the language, which is exactly what the cookie already varies on.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const [locale, t] = await Promise.all([appLocale(), getTranslations("pwa")])

  return {
    lang: locale,
    dir: "ltr",
    name: t("name"),
    short_name: t("shortName"),
    description: t("description"),
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  }
}
