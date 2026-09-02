import { describe, expect, it } from "vitest"
import { MAX_REFRESH_SYMBOLS, marketsWorthRefreshing } from "./refresh"
import { isAuthorizedCronRequest, timingSafeEqual } from "@/features/alerts/cron-auth"
import { marketSessionStatus } from "@/domain/calendar"

/**
 * The scheduled-refresh policy, tested without a database or a provider.
 *
 * What matters here is *when* a request is made and *whether* the endpoint is reachable — the
 * fetching itself is phase 9's, already covered by its own tests.
 */

describe("which markets are worth calling", () => {
  it("skips a market that is closed, because it publishes no new prices", () => {
    // A Sunday. Both exchanges are shut; refreshing either spends a credit to receive the number
    // already cached.
    const sunday = new Date("2026-09-06T14:30:00Z")
    expect(marketsWorthRefreshing(sunday)).toEqual([])
  })

  it("calls a market that is trading", () => {
    // Wednesday 14:30 UTC is 10:30 in New York, inside the session.
    const wednesday = new Date("2026-09-02T14:30:00Z")
    const markets = marketsWorthRefreshing(wednesday).map((entry) => entry.market)
    expect(markets).toContain("US")
  })

  it("calls a market in pre- or post-market, where prices still move", () => {
    // 12:00 UTC is 08:00 in New York: pre-market.
    const preMarket = new Date("2026-09-02T12:00:00Z")
    const entry = marketsWorthRefreshing(preMarket).find((m) => m.market === "US")
    expect(entry?.status).toBe("pre")
  })

  it("uses each market's own clock rather than one global one", () => {
    // 04:00 UTC: Bangkok is trading, New York has not opened and is not in pre-market either.
    const bangkokMorning = new Date("2026-09-02T04:00:00Z")
    const markets = marketsWorthRefreshing(bangkokMorning).map((entry) => entry.market)
    expect(markets).toContain("SET")
    expect(markets).not.toContain("US")
  })

  it("calls a market whose calendar is unverified rather than skipping it", () => {
    // Past the verified horizon the status is "unknown". One wasted request is cheaper than a
    // stale portfolio on a day the exchange was actually open.
    const beyond = new Date("2027-06-02T04:00:00Z")
    expect(marketSessionStatus("SET", beyond)).toBe("unknown")
    expect(marketsWorthRefreshing(beyond).map((m) => m.market)).toContain("SET")
  })

  it("bounds how much one run can cost", () => {
    expect(MAX_REFRESH_SYMBOLS).toBeGreaterThan(0)
    expect(MAX_REFRESH_SYMBOLS).toBeLessThanOrEqual(500)
  })
})

describe("the scheduled endpoint is not public", () => {
  const headersWith = (entries: Record<string, string>) => new Headers(entries)

  it("refuses every request when no secret is configured", () => {
    // An unset secret must never mean "open to everyone" — that is how a scheduled job becomes a
    // public endpoint anyone can hammer.
    expect(isAuthorizedCronRequest(headersWith({ authorization: "Bearer anything" }), "")).toBe(false)
    expect(isAuthorizedCronRequest(headersWith({}), "")).toBe(false)
  })

  it("accepts the bearer token Vercel Cron sends", () => {
    expect(isAuthorizedCronRequest(headersWith({ authorization: "Bearer s3cret" }), "s3cret")).toBe(true)
  })

  it("accepts the header an external scheduler can set", () => {
    expect(isAuthorizedCronRequest(headersWith({ "x-cron-secret": "s3cret" }), "s3cret")).toBe(true)
  })

  it("refuses a wrong secret, a prefix of it and an empty one", () => {
    expect(isAuthorizedCronRequest(headersWith({ "x-cron-secret": "wrong" }), "s3cret")).toBe(false)
    expect(isAuthorizedCronRequest(headersWith({ "x-cron-secret": "s3cre" }), "s3cret")).toBe(false)
    expect(isAuthorizedCronRequest(headersWith({ "x-cron-secret": "" }), "s3cret")).toBe(false)
  })

  it("compares in constant time, so the secret cannot be probed a byte at a time", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true)
    expect(timingSafeEqual("abc", "abd")).toBe(false)
    expect(timingSafeEqual("abc", "abcd")).toBe(false)
  })
})
