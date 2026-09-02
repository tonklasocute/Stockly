import { describe, expect, it, vi } from "vitest"

// getUser reaches for cookies(), which only exists inside a request. The guard's error mapping is
// what is under test here, not Supabase.
vi.mock("@/lib/supabase/server", () => ({
  getUser: vi.fn(async () => ({ id: "u1" })),
}))
vi.mock("@/lib/env", () => ({
  isSupabaseConfigured: () => true,
  env: { supabaseUrl: "https://example.supabase.co", supabaseAnonKey: "anon" },
}))

import { z } from "zod"
import { ApiError, guarded, MAX_REQUEST_BYTES, ok, parseBody, ValidationError } from "./api"

const request = (body: unknown) =>
  new Request("https://example.com/api/test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  })

const schema = z.object({ metric: z.enum(["RSI", "ADX"]), value: z.number() })

describe("parseBody", () => {
  it("returns the parsed value for a valid body", async () => {
    await expect(parseBody(request({ metric: "RSI", value: 30 }), schema)).resolves.toEqual({
      metric: "RSI",
      value: 30,
    })
  })

  it("throws a ValidationError naming the offending field", async () => {
    const error = await parseBody(request({ metric: "DROP TABLE", value: 30 }), schema).catch((e) => e)
    expect(error).toBeInstanceOf(ValidationError)
    expect(error.details).toHaveProperty("metric")
  })

  it("throws on a body that is not JSON at all", async () => {
    const bad = new Request("https://example.com/api/test", { method: "POST", body: "not json" })
    await expect(parseBody(bad, schema)).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("guarded", () => {
  it("returns 400 with the shared envelope when validation fails", async () => {
    // The bug this covers: a validation error escaping the wrapper surfaces as an empty 500, which
    // tells a client nothing and looks like a server fault rather than a bad request.
    const response = await guarded(async () => {
      await parseBody(request({ metric: "evil", value: 1 }), schema)
      return ok({})
    })

    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.success).toBe(false)
    expect(body.error.code).toBe("VALIDATION_ERROR")
    expect(body.error.details).toHaveProperty("metric")
  })

  it("maps an ApiError to its own status", async () => {
    const response = await guarded(async () => {
      throw new ApiError("CONFLICT", "Already exists.")
    })
    expect(response.status).toBe(409)
    expect((await response.json()).error.message).toBe("Already exists.")
  })

  it("turns an unexpected throw into a 500 that leaks nothing", async () => {
    const response = await guarded(async () => {
      throw new Error("connection to db-primary-7 at 10.0.0.4 refused")
    })
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.error.message).not.toContain("10.0.0.4")
    expect(body.error.code).toBe("INTERNAL_ERROR")
  })

  it("passes a successful response straight through", async () => {
    const response = await guarded(async () => ok({ fine: true }, 201))
    expect(response.status).toBe(201)
    expect((await response.json()).data).toEqual({ fine: true })
  })
})

describe("request size limit", () => {
  const big = (bytes: number) => "x".repeat(bytes)

  it("rejects a body whose declared Content-Length is over the limit, without reading it", async () => {
    const oversized = new Request("https://example.com/api/test", {
      method: "POST",
      body: JSON.stringify({ metric: "RSI", value: 30 }),
      headers: { "Content-Type": "application/json", "content-length": String(MAX_REQUEST_BYTES + 1) },
    })

    await expect(parseBody(oversized, schema)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" })
  })

  it("rejects an oversized body that declares no length at all", async () => {
    // A chunked request has no Content-Length, which is exactly how a naive check is bypassed.
    const chunked = new Request("https://example.com/api/test", {
      method: "POST",
      body: JSON.stringify({ metric: "RSI", value: 30, pad: big(MAX_REQUEST_BYTES) }),
      headers: { "Content-Type": "application/json" },
    })
    chunked.headers.delete("content-length")

    await expect(parseBody(chunked, schema)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" })
  })

  it("measures bytes rather than characters", async () => {
    // Each of these is three bytes of UTF-8, so a length check on the string would pass a body
    // three times over the limit.
    const multibyte = "\u0e01".repeat(Math.ceil(MAX_REQUEST_BYTES / 2))
    const request = new Request("https://example.com/api/test", {
      method: "POST",
      body: JSON.stringify({ metric: "RSI", value: 30, pad: multibyte }),
      headers: { "Content-Type": "application/json" },
    })
    request.headers.delete("content-length")

    await expect(parseBody(request, schema)).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" })
  })

  it("accepts an ordinary body", async () => {
    await expect(parseBody(request({ metric: "ADX", value: 25 }), schema)).resolves.toEqual({
      metric: "ADX",
      value: 25,
    })
  })

  it("reports malformed JSON as a validation error rather than a crash", async () => {
    const malformed = new Request("https://example.com/api/test", {
      method: "POST",
      body: "{not json",
      headers: { "Content-Type": "application/json" },
    })

    await expect(parseBody(malformed, schema)).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("error responses", () => {
  it("carries a request id a user can quote, and never a stack trace", async () => {
    const response = await guarded(async () => {
      throw new Error("connection to db-primary-7 at 10.0.0.4 refused")
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toBe("Something went wrong. Please try again.")
    expect(body.requestId).toMatch(/^[A-Za-z0-9_:.-]{8,128}$/)
    expect(response.headers.get("x-request-id")).toBe(body.requestId)
    // The real failure stays in the logs.
    expect(JSON.stringify(body)).not.toContain("10.0.0.4")
    expect(JSON.stringify(body)).not.toContain("db-primary-7")
  })
})
