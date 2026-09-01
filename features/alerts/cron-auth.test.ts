import { describe, expect, it } from "vitest"
import { isAuthorizedCronRequest, timingSafeEqual } from "./cron-auth"

const headers = (init: Record<string, string>) => new Headers(init)
const SECRET = "s3cr3t-value-for-tests"

describe("cron authorization", () => {
  it("accepts the Bearer header Vercel Cron sends", () => {
    expect(isAuthorizedCronRequest(headers({ authorization: `Bearer ${SECRET}` }), SECRET)).toBe(true)
  })

  it("accepts an x-cron-secret header from an external scheduler", () => {
    expect(isAuthorizedCronRequest(headers({ "x-cron-secret": SECRET }), SECRET)).toBe(true)
  })

  it("rejects a wrong secret", () => {
    expect(isAuthorizedCronRequest(headers({ "x-cron-secret": "wrong" }), SECRET)).toBe(false)
  })

  it("rejects a request with no credentials at all", () => {
    expect(isAuthorizedCronRequest(headers({}), SECRET)).toBe(false)
  })

  it("rejects EVERY request when no secret is configured", () => {
    // The dangerous failure mode: an unset environment variable silently opening the endpoint.
    expect(isAuthorizedCronRequest(headers({ "x-cron-secret": "" }), "")).toBe(false)
    expect(isAuthorizedCronRequest(headers({ authorization: "Bearer anything" }), "")).toBe(false)
  })

  it("is not fooled by a correct prefix", () => {
    expect(isAuthorizedCronRequest(headers({ "x-cron-secret": SECRET.slice(0, 5) }), SECRET)).toBe(false)
  })

  it("compares in constant time regardless of where the difference is", () => {
    expect(timingSafeEqual("abcdef", "abcdef")).toBe(true)
    expect(timingSafeEqual("abcdef", "abcdeX")).toBe(false)
    expect(timingSafeEqual("abcdef", "Xbcdef")).toBe(false)
    expect(timingSafeEqual("abc", "abcdef")).toBe(false)
  })
})
