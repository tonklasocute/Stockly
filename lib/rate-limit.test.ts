import { describe, expect, it } from "vitest"
import { rateLimit } from "./rate-limit"

const key = () => `test:${Math.random()}`

describe("rateLimit", () => {
  it("allows requests up to the limit", () => {
    const k = key()
    expect(rateLimit(k, 3, 60).allowed).toBe(true)
    expect(rateLimit(k, 3, 60).allowed).toBe(true)
    expect(rateLimit(k, 3, 60).allowed).toBe(true)
  })

  it("blocks the one after the limit and says how long to wait", () => {
    const k = key()
    for (let i = 0; i < 3; i += 1) rateLimit(k, 3, 60)
    const blocked = rateLimit(k, 3, 60)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it("keeps separate budgets per key, so one user cannot exhaust another's", () => {
    const a = key()
    const b = key()
    for (let i = 0; i < 5; i += 1) rateLimit(a, 2, 60)
    expect(rateLimit(b, 2, 60).allowed).toBe(true)
  })

  it("starts a fresh window once the old one expires", () => {
    const k = key()
    rateLimit(k, 1, 0) // a zero-second window has already expired by the next call
    expect(rateLimit(k, 1, 60).allowed).toBe(true)
  })

  it("reports the remaining budget", () => {
    const k = key()
    expect(rateLimit(k, 5, 60).remaining).toBe(4)
    expect(rateLimit(k, 5, 60).remaining).toBe(3)
  })
})
