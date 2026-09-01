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
import { ApiError, guarded, ok, parseBody, ValidationError } from "./api"

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
