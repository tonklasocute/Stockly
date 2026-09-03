import type { NextConfig } from "next"
import createNextIntlPlugin from "next-intl/plugin"

/*
 * next-intl, pointed at `lib/i18n/request.ts` rather than its default `./i18n/request.ts`.
 *
 * `CLAUDE.md` says cross-cutting infrastructure lives in `lib/`, and a top-level `i18n/` folder
 * would be a fourth place to look for wiring. The plugin takes the path, so the convention wins.
 */
const withNextIntl = createNextIntlPlugin("./lib/i18n/request.ts")

const nextConfig: NextConfig = {
  // "X-Powered-By: Next.js" tells an attacker which CVE list to read. It buys nothing.
  poweredByHeader: false,

  async headers() {
    return [
      {
        // The worker must never be served from a stale cache, or a release cannot roll out. Its
        // scope header lets a worker served from /sw.js control the whole origin.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        /*
         * `private`, and varying on the cookie, since phase 21.
         *
         * The manifest carries the app name and description, and those are now in the language the
         * request asked for. Under the previous `public, max-age=3600` a shared cache would have
         * served whichever language it saw first to everybody behind it — a Thai reader installing
         * an app named in English, and no way to tell why. `private` keeps it in the browser that
         * asked, and `Vary: Cookie` is correct for any cache that ignores that.
         */
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "private, max-age=3600" },
          { key: "Vary", value: "Cookie" },
        ],
      },
      {
        source: "/icons/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        // The baseline, applied to everything — including the static output and the service
        // worker, which the middleware matcher deliberately skips. Dynamic routes get these again
        // from the middleware, plus a per-request Content-Security-Policy nonce; see
        // lib/security-headers.ts, which is the single description of what the browser enforces.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
          },
          // Two years, subdomains included, preload-eligible. Vercel terminates TLS, so every
          // production response is already HTTPS; this is what stops the first request being HTTP.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        source: "/api/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ]
  },
}

export default withNextIntl(nextConfig)
