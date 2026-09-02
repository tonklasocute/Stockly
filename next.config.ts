import type { NextConfig } from "next"

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
        source: "/manifest.webmanifest",
        headers: [{ key: "Cache-Control", value: "public, max-age=3600" }],
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

export default nextConfig
