import { describe, expect, it } from "vitest"
import {
  coversEvent,
  dedupeEvents,
  describeEvent,
  dividendFundamentals,
  EVENT_TYPES,
  EVENT_LABELS,
  MARKET_EVENT_COVERAGE,
  relevantEvents,
  statusOf,
  upcoming,
  type CorporateEvent,
} from "./corporate-events"
import { FORBIDDEN_INSIGHT_PATTERNS } from "./insights"

const NOW = new Date("2026-09-03T12:00:00Z")

const event = (overrides: Partial<CorporateEvent> = {}): CorporateEvent => ({
  symbol: "AAPL",
  market: "US",
  type: "EARNINGS",
  date: "2026-09-15",
  estimated: false,
  status: "UPCOMING",
  title: "Q4 earnings",
  detail: null,
  amountPerShare: null,
  currency: null,
  ratio: null,
  source: "mock",
  fetchedAt: "2026-09-03T00:00:00.000Z",
  ...overrides,
})

describe("status", () => {
  it("is upcoming on or after today", () => {
    expect(statusOf({ date: "2026-09-03" }, NOW)).toBe("UPCOMING")
    expect(statusOf({ date: "2026-09-15" }, NOW)).toBe("UPCOMING")
  })

  it("is reported in the past", () => {
    expect(statusOf({ date: "2026-08-15" }, NOW)).toBe("REPORTED")
  })

  it("is unknown without a date, never upcoming", () => {
    // "We do not know when" and "it has not happened yet" are different statements, and only one
    // of them belongs on a calendar.
    expect(statusOf({ date: null }, NOW)).toBe("UNKNOWN")
  })
})

describe("the upcoming calendar", () => {
  const events = [
    event({ date: "2026-09-20" }),
    event({ date: "2026-08-01" }),
    event({ date: "2026-09-10" }),
    event({ date: null }),
  ]

  it("lists future events soonest first", () => {
    expect(upcoming(events, NOW).map((e) => e.date)).toEqual(["2026-09-10", "2026-09-20"])
  })

  it("excludes dateless events, because a calendar needs dates", () => {
    expect(upcoming(events, NOW).some((e) => e.date === null)).toBe(false)
  })

  it("is bounded", () => {
    const many = Array.from({ length: 100 }, (_, i) => event({ date: `2026-10-${String((i % 28) + 1).padStart(2, "0")}` }))
    expect(upcoming(many, NOW, 5)).toHaveLength(5)
  })
})

describe("market coverage", () => {
  it("does not claim every market supports every event type", () => {
    expect(coversEvent("US", "EARNINGS")).toBe(true)
    // SET's earnings dates are not consistently supplied, and saying so beats an empty calendar
    // that reads as "nothing is happening".
    expect(coversEvent("SET", "EARNINGS")).toBe(false)
    expect(coversEvent("SET", "EX_DIVIDEND")).toBe(true)
  })

  it("declares coverage for every market", () => {
    for (const market of ["US", "SET"] as const) {
      expect(MARKET_EVENT_COVERAGE[market].length).toBeGreaterThan(0)
    }
  })

  it("has a label for every event type", () => {
    for (const type of EVENT_TYPES) {
      expect(EVENT_LABELS[type].length).toBeGreaterThan(0)
    }
  })
})

describe("de-duplication", () => {
  it("keeps a confirmed date over an estimate", () => {
    // Providers re-send an event as its date firms up. A later fetch must never downgrade a
    // confirmed date back to an estimate.
    const merged = dedupeEvents([
      event({ date: "2026-09-15", estimated: true }),
      event({ date: "2026-09-17", estimated: false }),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].estimated).toBe(false)
    expect(merged[0].date).toBe("2026-09-17")
  })

  it("does not let an estimate replace a confirmation", () => {
    const merged = dedupeEvents([
      event({ date: "2026-09-17", estimated: false }),
      event({ date: "2026-09-15", estimated: true }),
    ])
    expect(merged[0].estimated).toBe(false)
  })

  it("keeps genuinely different events", () => {
    const merged = dedupeEvents([
      event({ type: "EARNINGS", date: "2026-09-15" }),
      event({ type: "DIVIDEND", date: "2026-09-15" }),
      event({ symbol: "MSFT", date: "2026-09-15" }),
    ])
    expect(merged).toHaveLength(3)
  })

  it("treats a re-dated event within a month as the same event", () => {
    const merged = dedupeEvents([
      event({ date: "2026-09-15" }),
      event({ date: "2026-09-18" }),
    ])
    expect(merged).toHaveLength(1)
  })
})

describe("relevance to a portfolio", () => {
  const events = [
    event({ symbol: "AAPL", date: "2026-09-20" }),
    event({ symbol: "MSFT", date: "2026-09-10" }),
    event({ symbol: "RANDOM", date: "2026-09-05" }),
  ]
  const held = new Set(["US:AAPL"])
  const watched = new Set(["US:MSFT"])

  it("includes only held and watched instruments", () => {
    // A calendar of every listed company is a news feed, and this is not one.
    const relevant = relevantEvents(events, held, watched, NOW)
    expect(relevant.map((e) => e.symbol)).toEqual(["AAPL", "MSFT"])
  })

  it("ranks a held position above a watched one, even when it is later", () => {
    const relevant = relevantEvents(events, held, watched, NOW)
    expect(relevant[0].relation).toBe("HELD")
  })

  it("returns nothing when the user holds and watches nothing", () => {
    expect(relevantEvents(events, new Set(), new Set(), NOW)).toEqual([])
  })
})

describe("event sentences", () => {
  it("marks an estimated date as estimated, every time", () => {
    // An estimated earnings date presented as confirmed is the most misleading thing a calendar
    // can do, because a reader plans around it.
    expect(describeEvent(event({ estimated: true }))).toContain("(estimated)")
    expect(describeEvent(event({ estimated: false }))).not.toContain("(estimated)")
  })

  it("says so when a date is not announced rather than inventing one", () => {
    expect(describeEvent(event({ date: null }))).toContain("not yet announced")
  })

  it("carries no portfolio figure", () => {
    // These reach a lock screen through push. Prices and per-share amounts are public; a position's
    // value is not.
    const sentences = EVENT_TYPES.map((type) =>
      describeEvent(event({ type, amountPerShare: 0.24, currency: "USD", ratio: "4:1" })),
    )
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/position|portfolio|you (own|hold)|worth/i)
    }
  })

  it("uses none of the forbidden vocabulary", () => {
    for (const type of EVENT_TYPES) {
      const sentence = describeEvent(event({ type, ratio: "4:1", amountPerShare: 0.24, currency: "USD" }))
      for (const pattern of FORBIDDEN_INSIGHT_PATTERNS) {
        expect(pattern.test(sentence), `"${sentence}" matched ${pattern}`).toBe(false)
      }
    }
  })
})

describe("dividend fundamentals", () => {
  const payments = [
    { date: "2026-08-01", amountPerShare: 0.25 },
    { date: "2026-05-01", amountPerShare: 0.25 },
    { date: "2026-02-01", amountPerShare: 0.24 },
    { date: "2025-11-01", amountPerShare: 0.24 },
    { date: "2025-08-01", amountPerShare: 0.23 },
    { date: "2025-05-01", amountPerShare: 0.22 },
    { date: "2025-02-01", amountPerShare: 0.22 },
  ]

  it("sums the trailing twelve months and counts the payments", () => {
    const result = dividendFundamentals(payments, 4, NOW)
    expect(result.trailingPerShare).toBeCloseTo(0.98, 6)
    expect(result.paymentsPerYear).toBe(4)
  })

  it("computes growth against the prior twelve months", () => {
    const result = dividendFundamentals(payments, 4, NOW)
    expect(result.growthPct).toBeGreaterThan(0)
  })

  it("has no growth figure for a company's first dividend year", () => {
    // Not infinite growth, and not zero growth either.
    const first = dividendFundamentals([{ date: "2026-08-01", amountPerShare: 0.25 }], 4, NOW)
    expect(first.growthPct).toBeNull()
  })

  it("computes a payout ratio only against positive earnings", () => {
    expect(dividendFundamentals(payments, 4, NOW).payoutRatio).toBeCloseTo(24.5, 4)
    // A dividend paid out of losses gives a ratio that is negative or enormous, and neither means
    // what a reader would take it to mean.
    expect(dividendFundamentals(payments, -2, NOW).payoutRatio).toBeNull()
    expect(dividendFundamentals(payments, null, NOW).payoutRatio).toBeNull()
  })

  it("reports nothing rather than zero when a company pays no dividend", () => {
    const none = dividendFundamentals([], 4, NOW)
    expect(none.trailingPerShare).toBeNull()
    expect(none.paymentsPerYear).toBeNull()
    expect(none.payoutRatio).toBeNull()
  })
})
