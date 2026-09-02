import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { InstallPrompt } from "@/features/pwa/components/install-prompt"
import { ServiceWorkerManager } from "@/features/pwa/components/service-worker"
import { NONCE_HEADER } from "@/lib/log"
import { SITE, SITE_URL } from "@/lib/site"
import { cn } from "@/lib/utils"
import { Providers } from "./providers"
import "./globals.css"

const sans = Geist({ subsets: ["latin"], variable: "--font-sans" })
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  // Absolute URLs for Open Graph and the canonical link are resolved against this.
  metadataBase: new URL(SITE_URL),
  title: { default: `${SITE.name} — ${SITE.tagline}`, template: `%s · ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
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
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined

  return (
    <html lang="en" suppressHydrationWarning>
      <body className={cn("font-sans antialiased", sans.variable, mono.variable)}>
        <Providers nonce={nonce}>
          {children}
          <ServiceWorkerManager />
          <InstallPrompt />
        </Providers>
        <Toaster position="top-center" />
      </body>
    </html>
  )
}
