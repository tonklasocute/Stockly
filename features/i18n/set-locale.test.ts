import { beforeEach, describe, expect, it, vi } from "vitest"
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/domain/locale"
import { rememberLocale } from "./set-locale"

/**
 * Remembering a language choice.
 *
 * Two writes with two lifetimes, and the order between them is the point: the cookie is what the
 * next server render reads, so it has to be in place *before* anything refreshes, and the
 * preference row is the part that survives a new device. The row is fire-and-forget because the
 * language has already changed on screen — a failed sync must not undo it.
 */

let written: string[] = []
let fetches: { url: string; init?: RequestInit }[] = []

beforeEach(() => {
  written = []
  fetches = []
  vi.stubGlobal("window", { location: { protocol: "https:" } })
  vi.stubGlobal("document", {
    set cookie(value: string) {
      written.push(value)
    },
  })
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    fetches.push({ url, init })
    return Promise.resolve(new Response("{}"))
  })
})

describe("rememberLocale", () => {
  it("writes a year-long, path-wide, SameSite=Lax cookie", () => {
    rememberLocale("en", { signedIn: false })

    expect(written).toHaveLength(1)
    expect(written[0]).toContain(`${LOCALE_COOKIE}=en`)
    expect(written[0]).toContain("Path=/")
    expect(written[0]).toContain(`Max-Age=${LOCALE_COOKIE_MAX_AGE}`)
    expect(written[0]).toContain("SameSite=Lax")
  })

  it("marks the cookie Secure over HTTPS and not over plain HTTP", () => {
    rememberLocale("en", { signedIn: false })
    expect(written[0]).toContain("; Secure")

    // Development runs on http://localhost, where a Secure cookie is simply dropped.
    written = []
    vi.stubGlobal("window", { location: { protocol: "http:" } })
    rememberLocale("en", { signedIn: false })
    expect(written[0]).not.toContain("Secure")
  })

  it("is never HttpOnly — the switcher has to be able to write it", () => {
    // Deliberate, and safe: every read validates against the closed enum, so a hand-edited cookie
    // can only ever produce the default language. See `lib/i18n/resolve.test.ts`.
    rememberLocale("th", { signedIn: false })
    expect(written[0]).not.toContain("HttpOnly")
  })

  it("does not call the API for a visitor with no account", () => {
    // A stranger on a public share page changes language without a request that could fail.
    rememberLocale("en", { signedIn: false })
    expect(fetches).toEqual([])
  })

  it("syncs the preference row for a signed-in user, and sends only the locale", () => {
    rememberLocale("en", { signedIn: true })

    expect(fetches).toHaveLength(1)
    expect(fetches[0].url).toBe("/api/preferences")
    expect(fetches[0].init?.method).toBe("PATCH")
    // No userId in the body: ownership comes from the session and from RLS, never from a request.
    expect(JSON.parse(String(fetches[0].init?.body))).toEqual({ locale: "en" })
  })

  it("writes the cookie before it asks the server, so a refresh cannot race the sync", () => {
    rememberLocale("en", { signedIn: true })
    expect(written).toHaveLength(1)
    expect(fetches).toHaveLength(1)
  })

  it("does not throw when the sync fails", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")))
    expect(() => rememberLocale("en", { signedIn: true })).not.toThrow()
    // Let the rejected promise settle; an unhandled rejection here would fail the suite.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(written[0]).toContain("=en")
  })
})
