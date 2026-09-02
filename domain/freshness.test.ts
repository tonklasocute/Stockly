import { describe, expect, it } from "vitest"
import {
  describeFreshness,
  freshnessOf,
  FRESHNESS_POLICY,
  FRESHNESS_STATES,
  staleAfterMinutes,
} from "./freshness"
import { MAX_READING_AGE_MINUTES } from "./alerts"
import { DATA_QUALITY_THRESHOLDS } from "./data-quality"
import { INSIGHT_THRESHOLDS } from "./insights"

/**
 * The freshness policy, and the agreement between the modules that read it.
 *
 * The last two blocks are the point of the module existing: they fail if somebody edits one
 * threshold and leaves the others behind, which is what happened before it did.
 */

describe("classifying a reading", () => {
  it("is fresh below the threshold and stale at it", () => {
    expect(freshnessOf(14, "quote")).toBe("FRESH")
    expect(freshnessOf(15, "quote")).toBe("STALE")
    expect(freshnessOf(120, "quote")).toBe("STALE")
  })

  it("reports a missing reading as unavailable, never as stale", () => {
    // "We have no price" and "we have an old price" are different facts. Collapsing them is the
    // same mistake as rendering a missing figure as 0.
    expect(freshnessOf(null, "quote")).toBe("UNAVAILABLE")
    expect(freshnessOf(Number.NaN, "quote")).toBe("UNAVAILABLE")
    expect(freshnessOf(Number.POSITIVE_INFINITY, "quote")).toBe("UNAVAILABLE")
  })

  it("applies each policy's own threshold", () => {
    expect(freshnessOf(20, "quote")).toBe("STALE")
    expect(freshnessOf(20, "quoteNotice")).toBe("FRESH")
    expect(freshnessOf(20, "fx")).toBe("FRESH")
    expect(freshnessOf(20, "snapshot")).toBe("FRESH")
  })

  it("never describes a stale reading as current", () => {
    expect(describeFreshness(90, "quote")).toContain("Delayed")
    expect(describeFreshness(null, "quote")).toContain("No market price")
    expect(describeFreshness(1, "quote")).not.toContain("Delayed")
  })

  it("has exactly three states, so a caller cannot forget one", () => {
    expect([...FRESHNESS_STATES]).toEqual(["FRESH", "STALE", "UNAVAILABLE"])
  })
})

describe("the modules that read the policy still agree with it", () => {
  it("the alert engine acts on the quote threshold", () => {
    expect(MAX_READING_AGE_MINUTES).toBe(staleAfterMinutes("quote"))
  })

  it("the data-quality scan calls a price delayed at the same age", () => {
    // This is the one that had drifted: a copied `15` under a comment claiming it matched the alert
    // engine, with nothing enforcing the claim.
    expect(DATA_QUALITY_THRESHOLDS.stalePriceMinutes).toBe(MAX_READING_AGE_MINUTES)
    expect(DATA_QUALITY_THRESHOLDS.staleFxMinutes).toBe(staleAfterMinutes("fx"))
  })

  it("the insight notice is deliberately quieter than the alert guard", () => {
    // Not a bug and not an accident: an insight is a sentence somebody reads, so it waits longer
    // than the badge beside the figure. Asserted so the difference stays a decision.
    expect(INSIGHT_THRESHOLDS.staleness.quoteMinutes).toBe(staleAfterMinutes("quoteNotice"))
    expect(INSIGHT_THRESHOLDS.staleness.quoteMinutes).toBeGreaterThan(MAX_READING_AGE_MINUTES)
  })
})

describe("the thresholds themselves", () => {
  it("are ordered from strictest to loosest, which is what makes them explicable", () => {
    expect(FRESHNESS_POLICY.quote.minutes).toBeLessThan(FRESHNESS_POLICY.quoteNotice.minutes)
    expect(FRESHNESS_POLICY.quoteNotice.minutes).toBeLessThan(FRESHNESS_POLICY.fx.minutes)
    expect(FRESHNESS_POLICY.fx.minutes).toBeLessThan(FRESHNESS_POLICY.snapshot.minutes)
  })

  it("are the values they were before centralising, so this changed no behaviour", () => {
    expect(FRESHNESS_POLICY.quote.minutes).toBe(15)
    expect(FRESHNESS_POLICY.quoteNotice.minutes).toBe(30)
    expect(FRESHNESS_POLICY.fx.minutes).toBe(60)
    expect(FRESHNESS_POLICY.snapshot.minutes).toBe(90)
  })
})
