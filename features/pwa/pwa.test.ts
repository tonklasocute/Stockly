import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import manifest from "@/app/manifest"
import { APP_VERSION } from "@/lib/version"

const SW = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8")

describe("web app manifest", () => {
  const m = manifest()

  it("uses the production name, never a development one", () => {
    expect(m.name).toBe("Stockly — Portfolio Tracker")
    expect(m.short_name).toBe("Stockly")
    expect(`${m.name} ${m.short_name}`).not.toMatch(/dev|test|mvp|staging/i)
  })

  it("launches standalone from the dashboard, scoped to the whole origin", () => {
    expect(m.display).toBe("standalone")
    expect(m.start_url).toBe("/dashboard")
    expect(m.scope).toBe("/")
  })

  it("declares the icon sizes an installable app needs, including a maskable one", () => {
    const sizes = m.icons?.map((i) => i.sizes) ?? []
    expect(sizes).toContain("192x192")
    expect(sizes).toContain("512x512")
    expect(m.icons?.some((i) => i.purpose === "maskable")).toBe(true)
  })

  it("sets theme and background colours so the splash screen is not white-on-dark", () => {
    expect(m.theme_color).toBeTruthy()
    expect(m.background_color).toBeTruthy()
  })

  it("has a description, which Android shows in the install dialog", () => {
    expect(m.description?.length).toBeGreaterThan(10)
  })
})

describe("service worker — security", () => {
  it("never intercepts the API, where every response is user-specific", () => {
    expect(SW).toContain('url.pathname.startsWith("/api/")')
    expect(SW).toContain('url.pathname.startsWith("/auth/")')
  })

  it("never caches a navigation response", () => {
    // Every page in this app is server-rendered per user, so a cached page is another user's data.
    expect(SW).toContain("networkOnlyWithOfflineFallback")
    expect(SW).not.toMatch(/cache\.put\(request[\s\S]{0,80}navigate/)
  })

  it("ignores non-GET requests, so a mutation can never be replayed from a cache", () => {
    expect(SW).toContain('request.method !== "GET"')
  })

  it("ignores other origins, including the market data provider", () => {
    expect(SW).toContain("url.origin !== self.location.origin")
  })

  it("only caches responses from this origin", () => {
    expect(SW).toContain('response.type === "basic"')
  })

  it("exposes a cache wipe for sign-out", () => {
    expect(SW).toContain("CLEAR_CACHES")
  })
})

describe("service worker — lifecycle", () => {
  it("derives its cache version from the registration URL, not a hardcoded constant", () => {
    expect(SW).toContain('searchParams.get("v")')
  })

  it("deletes every cache that is not the current version on activate", () => {
    expect(SW).toContain("caches.delete(name)")
  })

  it("waits for the page to accept an update rather than reloading on its own", () => {
    expect(SW).toContain("SKIP_WAITING")
    // skipWaiting on install is fine (first install); the update path must be message-driven.
    expect(SW).toContain('event.data?.type === "SKIP_WAITING"')
  })

  it("precaches the offline fallback and the icons", () => {
    expect(SW).toContain('const OFFLINE_URL = "/offline"')
    expect(SW).toContain("/icons/icon-192.png")
  })

  it("survives one failed precache asset instead of aborting the install", () => {
    expect(SW).toContain("Promise.allSettled")
  })
})

describe("app version", () => {
  it("is a semver string used to bust the worker's caches", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
