import { afterEach, describe, expect, it } from "vitest"
import {
  applySecurityHeaders,
  buildCsp,
  createNonce,
  cspMode,
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  staticSecurityHeaders,
} from "./security-headers"

/**
 * The policy is the one piece of production configuration whose failure is invisible in
 * development and total in production, so it gets asserted rather than eyeballed.
 */

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl
  delete process.env.CSP_MODE
})

function directives(csp: string): Record<string, string> {
  return Object.fromEntries(
    csp.split(";").map((part) => {
      const [name, ...values] = part.trim().split(/\s+/)
      return [name, values.join(" ")]
    }),
  )
}

describe("buildCsp", () => {
  it("closes the directives that matter, with no wildcards", () => {
    const d = directives(buildCsp("abc123"))
    expect(d["default-src"]).toBe("'self'")
    expect(d["object-src"]).toBe("'none'")
    expect(d["frame-src"]).toBe("'none'")
    expect(d["frame-ancestors"]).toBe("'none'")
    expect(d["base-uri"]).toBe("'self'")
    expect(d["form-action"]).toBe("'self'")
  })

  it("carries the request's nonce and strict-dynamic", () => {
    const d = directives(buildCsp("abc123"))
    expect(d["script-src"]).toContain("'nonce-abc123'")
    expect(d["script-src"]).toContain("'strict-dynamic'")
  })

  it("allows inline styles, because React writes the style prop as an attribute", () => {
    // Nonces do not apply to attributes, so the alternative is charts that cannot position
    // themselves. Documented rather than silently permitted.
    expect(directives(buildCsp("n"))["style-src"]).toContain("'unsafe-inline'")
  })

  it("never allows unsafe-eval in production", () => {
    expect(buildCsp("n", { dev: false })).not.toContain("'unsafe-eval'")
    // Development needs it for the hot-reload runtime, and only there.
    expect(buildCsp("n", { dev: true })).toContain("'unsafe-eval'")
  })

  it("upgrades insecure requests in production but not on http://localhost", () => {
    expect(buildCsp("n", { dev: false })).toContain("upgrade-insecure-requests")
    expect(buildCsp("n", { dev: true })).not.toContain("upgrade-insecure-requests")
  })

  it("lets the browser reach Supabase, and nothing else", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://abc.supabase.co"
    const connect = directives(buildCsp("n"))["connect-src"]
    expect(connect).toContain("'self'")
    expect(connect).toContain("https://abc.supabase.co")
    expect(connect).toContain("wss://abc.supabase.co")
    expect(connect).not.toContain("*")
  })

  it("degrades to same-origin when Supabase is unset rather than emitting a broken directive", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    expect(directives(buildCsp("n"))["connect-src"]).toBe("'self'")
  })

  it("ignores an unparseable Supabase URL instead of injecting it into the policy", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "not a url; script-src *"
    expect(directives(buildCsp("n"))["connect-src"]).toBe("'self'")
  })
})

describe("createNonce", () => {
  it("is fresh every time — a reused nonce is the same as no nonce", () => {
    const nonces = new Set(Array.from({ length: 200 }, () => createNonce()))
    expect(nonces.size).toBe(200)
  })

  it("is base64 and long enough to be unguessable", () => {
    const nonce = createNonce()
    expect(nonce).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(atob(nonce).length).toBe(16)
  })
})

describe("staticSecurityHeaders", () => {
  it("sends HSTS in production and never in development", () => {
    expect(staticSecurityHeaders({ dev: false })["Strict-Transport-Security"]).toContain("max-age=63072000")
    // Pinning localhost to https would break every other project on that port, for two years.
    expect(staticSecurityHeaders({ dev: true })["Strict-Transport-Security"]).toBeUndefined()
  })

  it("disables the device APIs the app never uses", () => {
    const policy = staticSecurityHeaders()["Permissions-Policy"]
    for (const feature of ["camera", "microphone", "geolocation", "payment", "usb"]) {
      expect(policy).toContain(`${feature}=()`)
    }
  })
})

describe("cspMode", () => {
  it("enforces by default — a report-only policy nobody promotes protects nobody", () => {
    expect(cspMode()).toBe("enforce")
  })

  it("honours an explicit override", () => {
    process.env.CSP_MODE = "report-only"
    expect(cspMode()).toBe("report-only")
    process.env.CSP_MODE = "off"
    expect(cspMode()).toBe("off")
  })

  it("falls back to enforcing on a value it does not recognise", () => {
    process.env.CSP_MODE = "disabled"
    expect(cspMode()).toBe("enforce")
  })
})

describe("applySecurityHeaders", () => {
  it("writes the enforcing header, the report-only header, or neither", () => {
    const enforced = new Headers()
    applySecurityHeaders(enforced, "default-src 'self'", "enforce")
    expect(enforced.get(CSP_HEADER)).toBeTruthy()
    expect(enforced.get(CSP_REPORT_ONLY_HEADER)).toBeNull()

    const reported = new Headers()
    applySecurityHeaders(reported, "default-src 'self'", "report-only")
    expect(reported.get(CSP_REPORT_ONLY_HEADER)).toBeTruthy()
    expect(reported.get(CSP_HEADER)).toBeNull()

    const off = new Headers()
    applySecurityHeaders(off, "default-src 'self'", "off")
    expect(off.get(CSP_HEADER)).toBeNull()
    expect(off.get(CSP_REPORT_ONLY_HEADER)).toBeNull()
    // The rest of the headers are not optional, whatever the CSP mode is.
    expect(off.get("X-Content-Type-Options")).toBe("nosniff")
  })
})
