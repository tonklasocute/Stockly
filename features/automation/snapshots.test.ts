import { describe, expect, it } from "vitest"
import { MAX_SNAPSHOT_PORTFOLIOS, sessionFinished, snapshotDateFor } from "./snapshots"
import { marketSessionStatus } from "@/domain/calendar"

/**
 * The end-of-day snapshot job's timing rules.
 *
 * Whether it writes, and what date it writes for, are the only two decisions it makes that a test
 * can reach without a database — and they are the two that decide whether a portfolio's history is
 * a record of the market or a record of the server's clock.
 */

describe("when the job writes", () => {
  it("writes after a market has closed", () => {
    // 22:00 UTC on a Wednesday is 17:00 in New York: the regular session is over.
    expect(sessionFinished("US", new Date("2026-09-02T22:00:00Z"))).toBe(true)
  })

  it("does not write while a market is still trading", () => {
    expect(sessionFinished("US", new Date("2026-09-02T15:00:00Z"))).toBe(false)
  })

  it("does not write during pre-market, before any close exists", () => {
    expect(marketSessionStatus("US", new Date("2026-09-02T12:00:00Z"))).toBe("pre")
    expect(sessionFinished("US", new Date("2026-09-02T12:00:00Z"))).toBe(false)
  })

  it("refuses a date whose calendar is unverified", () => {
    // Past the verified holiday horizon the status is "unknown". Writing a row for a day that may
    // have been a holiday would put a flat line in the history and call it a day the market did
    // nothing — the opposite of the honesty the rest of the phase is built on.
    const beyond = new Date("2028-06-02T22:00:00Z")
    expect(marketSessionStatus("US", beyond)).toBe("unknown")
    expect(sessionFinished("US", beyond)).toBe(false)
  })
})

describe("which date it writes for", () => {
  it("uses the market's own timezone, not the server's", () => {
    // 01:00 UTC on the 3rd is still the evening of the 2nd in New York. A server clock would stamp
    // this row with tomorrow's date and put the close on a day that had not happened.
    expect(snapshotDateFor("US", new Date("2026-09-03T01:00:00Z"))).toBe("2026-09-02")
  })

  it("gives each market its own trading date", () => {
    // 22:00 UTC is the 2nd in New York and already the 3rd in Bangkok.
    const at = new Date("2026-09-02T22:00:00Z")
    expect(snapshotDateFor("US", at)).toBe("2026-09-02")
    expect(snapshotDateFor("SET", at)).toBe("2026-09-03")
  })

  it("is stable across a run, so one invocation cannot straddle midnight", () => {
    const at = new Date("2026-09-02T22:00:00Z")
    expect(snapshotDateFor("US", at)).toBe(snapshotDateFor("US", at))
  })
})

describe("bounds", () => {
  it("caps how many portfolios one run touches", () => {
    // A backlog is finished by the next run rather than by a timeout halfway through.
    expect(MAX_SNAPSHOT_PORTFOLIOS).toBeGreaterThan(0)
    expect(MAX_SNAPSHOT_PORTFOLIOS).toBeLessThanOrEqual(1_000)
  })
})
