import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
import { Geist, Geist_Mono, Noto_Sans_Thai } from "next/font/google"
import { NextIntlClientProvider } from "next-intl"
import { getTranslations } from "next-intl/server"
import { Toaster } from "@/components/ui/sonner"
import { InstallPrompt } from "@/features/pwa/components/install-prompt"
import { ServiceWorkerManager } from "@/features/pwa/components/service-worker"
import { resolveLocale } from "@/lib/i18n/resolve"
import { appLocale } from "@/lib/i18n/server"
import { NONCE_HEADER } from "@/lib/log"
import { SITE, SITE_URL } from "@/lib/site"
import { cn } from "@/lib/utils"
import { Providers } from "./providers"
import "./globals.css"

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

/*
 * Geist ships no Thai glyphs, so a Thai page would fall back to whatever the device happens to
 * have — Thonburi on iOS, Leelawadee on Windows — at a different weight and x-height from every
 * Latin character beside it. Noto Sans Thai is loaded as a *second* family in the same stack, so
 * Latin still renders in Geist and only Thai characters change font. `display: "swap"` keeps it off
 * the critical path: a first paint in the fallback face costs a reflow, a blocked paint costs the
 * page.
 */
const thai = Noto_Sans_Thai({ subsets: ["thai"], variable: "--font-thai", display: "swap" })

/**
 * Localized, so a link shared in a Thai conversation previews in Thai.
 *
 * `generateMetadata` replaces the static export because a title has to be resolved per request
 * once it depends on a cookie. Everything that is not language — the icons, the manifest link, the
 * Apple tags, `metadataBase` — is unchanged and still decided once.
 */
export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([appLocale(), getTranslations("metadata")])

  return {
  // Absolute URLs for Open Graph and the canonical link are resolved against this.
  metadataBase: new URL(SITE_URL),
  title: { default: t("title"), template: `%s · ${SITE.name}` },
  description: t("description"),
  applicationName: SITE.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    locale,
    title: t("title"),
    description: t("description"),
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: t("title"),
    description: t("description"),
  },
  // iOS ignores the manifest: these tags are what make a home-screen launch open standalone with
  // the right title and status bar.
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Stockly" },
  formatDetection: { telephone: false },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: {
    // Safari on iPadOS still reads the legacy name.
    "mobile-web-app-capable": "yes",
  },
  }
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  // The installed app draws under the notch and the home indicator; .safe-* classes pad it back.
  viewportFit: "cover",
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom stays available (never disable it — it is an accessibility feature), but the page
  // does not zoom on its own when a form field is focused on iOS.
  maximumScale: 5,
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // next-themes injects an inline script that sets the theme class before first paint. Under the
  // nonce-based CSP that script is blocked unless it carries the nonce, and the page would flash
  // the wrong theme on every load. Next nonces its own scripts from the CSP header; this one has
  // to be handed the value.
  const [requestHeaders, locale] = await Promise.all([headers(), resolveLocale()])
  const nonce = requestHeaders.get(NONCE_HEADER) ?? undefined

  /*
   * `lang` carries the plain code, not the Gregorian-pinned `Intl` tag.
   *
   * It is read by screen readers to choose a voice and by the browser to choose hyphenation; a
   * calendar extension means nothing to either, and `lang="th-TH-u-ca-gregory"` is a string no
   * assistive technology should have to parse. The tag that pins the calendar is the one handed to
   * `Intl`, in `domain/locale.ts`.
   */
  return (
    <html lang={locale} suppressHydrationWarning>
      <body className={cn("font-sans antialiased", sans.variable, mono.variable, thai.variable)}>
        {/*
          * One provider carries the language to the client, and it is next-intl's.
          *
          * It is rendered here, in a Server Component, so it picks up the locale and messages that
          * `lib/i18n/request.ts` already resolved — no second resolution, nothing to disagree with
          * the server render, and therefore no hydration mismatch over a label. It also means only
          * the active locale's messages are serialised into the page.
          */}
        <NextIntlClientProvider>
          <Providers nonce={nonce}>
            {children}
            <ServiceWorkerManager />
            <InstallPrompt />
          </Providers>
          <Toaster position="top-center" />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
