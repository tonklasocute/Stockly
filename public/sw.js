/* Stockly service worker.
 *
 * Hand-written rather than generated. What it has to do is small and the security rule is strict
 * enough that a generic runtime-caching plugin would be a liability: a portfolio value cached from
 * one signed-in user and replayed to the next is the worst bug this app could have.
 *
 * THE RULE: nothing authenticated is ever written to the cache. Not /api/**, not an HTML page (every
 * page in this app is user-specific and server-rendered). Only the offline fallback and the build's
 * immutable static assets are stored.
 *
 * Update strategy: the page registers this worker as /sw.js?v=<APP_VERSION>. A changed URL is a
 * different worker to the browser, so a release installs a new one automatically; the version is
 * read back from the query string here, so lib/version.ts stays the single source of truth and no
 * build step has to rewrite this file.
 */

const CACHE_VERSION = new URL(self.location.href).searchParams.get("v") ?? "dev"
const SHELL_CACHE = `stockly-shell-${CACHE_VERSION}`
const ASSET_CACHE = `stockly-assets-${CACHE_VERSION}`
const OFFLINE_URL = "/offline"

/** The minimum needed to render something recognisable with no network. */
const SHELL_ASSETS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/apple-touch-icon.png",
]

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // One failed asset must not abort the whole install and leave the app without a worker.
      await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)))
      // Do not wait for every tab to close: the new worker takes over on the next activate.
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names
          .filter((name) => name !== SHELL_CACHE && name !== ASSET_CACHE)
          .map((name) => caches.delete(name)),
      )
      await self.clients.claim()
    })(),
  )
})

/**
 * The page asks for a skipWaiting when the user accepts an update, and for a cache wipe on logout.
 * Logout is belt-and-braces — no authenticated response is ever cached — but it costs nothing and
 * guarantees the next user of this device starts from an empty store.
 */
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting()
  if (event.data?.type === "CLEAR_CACHES") {
    event.waitUntil(caches.keys().then((names) => Promise.all(names.map((n) => caches.delete(n)))))
  }
})

/**
 * Web Push.
 *
 * The payload carries only what the server chose to expose — a title, a body and an in-app path.
 * Portfolio figures never appear here: this text can be shown on a locked screen to whoever is
 * holding the device. See domain/alerts.ts `messageFor`.
 */
self.addEventListener("push", (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    // A malformed payload still deserves a notification, just a generic one.
    payload = {}
  }

  const title = payload.title || "Stockly"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body || "Open Stockly for details.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      // Same tag replaces the previous notification for that alert instead of stacking.
      tag: payload.tag || "stockly",
      renotify: false,
      data: { href: typeof payload.href === "string" ? payload.href : "/notifications" },
    }),
  )
})

/**
 * Tapping a notification focuses an open Stockly window and navigates it, rather than opening a
 * second copy — which is what an installed app should do.
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const raw = event.notification.data?.href ?? "/notifications"
  // Only same-origin paths: a payload can never be used to send the user somewhere else.
  const href = typeof raw === "string" && raw.startsWith("/") ? raw : "/notifications"

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && "focus" in client) {
          await client.focus()
          if ("navigate" in client) await client.navigate(href)
          return
        }
      }
      await self.clients.openWindow(href)
    })(),
  )
})

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/apple-touch-icon.png" ||
    /\.(?:css|js|woff2?|png|jpg|jpeg|svg|webp|ico)$/.test(url.pathname)
  )
}

/** Immutable build output: serve from cache, fall back to network, store what the network returns. */
async function cacheFirst(request) {
  const cached = await caches.match(request)
  if (cached) return cached

  const response = await fetch(request)
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(ASSET_CACHE)
    cache.put(request, response.clone())
  }
  return response
}

/**
 * Navigations: always the network, because every page is user-specific and server-rendered. On
 * failure, the offline page — never a stale copy of somebody's portfolio.
 */
async function networkOnlyWithOfflineFallback(request) {
  try {
    return await fetch(request)
  } catch {
    const offline = await caches.match(OFFLINE_URL)
    return (
      offline ??
      new Response("You are offline.", { status: 503, headers: { "Content-Type": "text/plain" } })
    )
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event

  // A cache can only serve GETs, and a mutation must never be replayed from one.
  if (request.method !== "GET") return

  const url = new URL(request.url)

  // Other origins (fonts, the market-data provider) are none of this worker's business.
  if (url.origin !== self.location.origin) return

  // Never touch authenticated endpoints or the auth routes. They go straight to the network, and
  // when the network is gone the caller sees a real failure rather than someone else's data.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return

  if (request.mode === "navigate") {
    event.respondWith(networkOnlyWithOfflineFallback(request))
    return
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request))
  }
})
