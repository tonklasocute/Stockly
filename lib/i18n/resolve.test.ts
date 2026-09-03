import { describe, expect, it, vi } from "vitest"
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_HEADER, LOCALE_PARAM } from "@/domain/locale"

/**
 * How a request's language is decided.
 *
 * The chain is short but every step of it has a reason, and each one has a way of going quietly
 * wrong: a cookie that is trusted, a stored preference read on every render, or — worst — a shared
 * page answered in the *owner's* language because the resolver used the ambient cookie instead of
 * the visitor's `?lang=`.
 */

let cookies: { name: string; value: string }[] = []
let requestHeaders: Record<string, string> = {}
let preference: string | null = null

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => cookies.find((c) => c.name === name),
    getAll: () => cookies,
  }),
  headers: async () => ({ get: (name: string) => requestHeaders[name] ?? null }),
}))
vi.mock("@/features/personalization/queries", () => ({
  loadPreferences: async () => {
    if (preference === null) throw new Error("no row")
    return { locale: preference }
  },
}))

const { resolveLocale, resolvePublicLocale } = await import("./resolve")

const reset = () => {
  cookies = []
  requestHeaders = {}
  preference = null
}

describe("resolveLocale — the app", () => {
  it("uses the URL-chosen language the middleware set, above everything else", async () => {
    reset()
    // Only ever set on a shared route, and there the visitor's URL beats a cookie that may be the
    // owner's. This is what keeps `<html lang>` agreeing with the body.
    requestHeaders[LOCALE_HEADER] = "en"
    cookies = [{ name: LOCALE_COOKIE, value: "th" }, { name: "sb-a-auth-token", value: "…" }]
    preference = "th"
    expect(await resolveLocale()).toBe("en")
  })

  it("ignores a header that is not a supported locale", async () => {
    reset()
    requestHeaders[LOCALE_HEADER] = "<script>"
    expect(await resolveLocale()).toBe(DEFAULT_LOCALE)
  })

  it("uses the cookie the switcher wrote", async () => {
    reset()
    cookies = [{ name: LOCALE_COOKIE, value: "en" }]
    expect(await resolveLocale()).toBe("en")
  })

  it("falls back to the stored preference on a device with no cookie", async () => {
    reset()
    // A Supabase auth cookie is present, so there is somebody to have a preference.
    cookies = [{ name: "sb-abc-auth-token", value: "…" }]
    preference = "en"
    expect(await resolveLocale()).toBe("en")
  })

  it("does not touch the database when there is plainly no session", async () => {
    reset()
    // No `sb-` cookie: an anonymous request must not pay for an auth round trip to pick a language.
    preference = "en"
    expect(await resolveLocale()).toBe(DEFAULT_LOCALE)
  })

  it("prefers the cookie over the stored preference, so a render never waits on a query", async () => {
    reset()
    cookies = [
      { name: LOCALE_COOKIE, value: "th" },
      { name: "sb-abc-auth-token", value: "…" },
    ]
    preference = "en"
    expect(await resolveLocale()).toBe("th")
  })

  it("defaults to Thai when there is nothing to go on", async () => {
    reset()
    expect(await resolveLocale()).toBe("th")
  })

  it("refuses a cookie that is not a supported locale", async () => {
    reset()
    for (const value of ["", "EN", "en-GB", "de", "<script>alert(1)</script>", "../../etc/passwd"]) {
      cookies = [{ name: LOCALE_COOKIE, value }]
      expect(await resolveLocale(), value).toBe(DEFAULT_LOCALE)
    }
  })

  it("survives a failure to read the preference rather than failing the page", async () => {
    reset()
    cookies = [{ name: "sb-abc-auth-token", value: "…" }]
    preference = null // the mock throws
    expect(await resolveLocale()).toBe(DEFAULT_LOCALE)
  })
})

describe("resolvePublicLocale — a shared page", () => {
  it("takes the visitor's ?lang= first", async () => {
    reset()
    cookies = [{ name: LOCALE_COOKIE, value: "th" }]
    expect(await resolvePublicLocale({ [LOCALE_PARAM]: "en" })).toBe("en")
  })

  it("reads the first value when a parameter is repeated", async () => {
    reset()
    expect(await resolvePublicLocale({ [LOCALE_PARAM]: ["en", "th"] })).toBe("en")
  })

  it("falls back to this device's cookie, then to the default", async () => {
    reset()
    cookies = [{ name: LOCALE_COOKIE, value: "en" }]
    expect(await resolvePublicLocale({})).toBe("en")

    reset()
    expect(await resolvePublicLocale({})).toBe(DEFAULT_LOCALE)
    expect(await resolvePublicLocale(undefined)).toBe(DEFAULT_LOCALE)
  })

  it("refuses a crafted ?lang= rather than echoing it", async () => {
    reset()
    for (const value of ["<script>", "en'; drop table", "..%2f", "TH"]) {
      expect(await resolvePublicLocale({ [LOCALE_PARAM]: value }), value).toBe(DEFAULT_LOCALE)
    }
  })

  /*
   * The one that matters most. An owner reading their own portfolio in Thai sends a Thai cookie
   * with every request; a stranger opening `?lang=en` must not be answered in Thai because of it.
   */
  it("never lets the owner's cookie decide a stranger's page", async () => {
    reset()
    cookies = [{ name: LOCALE_COOKIE, value: "th" }, { name: "sb-owner-auth-token", value: "…" }]
    preference = "th"
    expect(await resolvePublicLocale({ [LOCALE_PARAM]: "en" })).toBe("en")
  })
})
