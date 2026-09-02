import { describe, expect, it } from "vitest"
import {
  DATA_QUALITY_THRESHOLDS,
  scanDataQuality,
  summariseIssues,
  worstSeverity,
  type DataQualityInput,
} from "./data-quality"

const AT = "2026-09-02T12:00:00Z"

const clean: DataQualityInput = {
  baseCurrency: "USD",
  holdingsWithoutPrice: [],
  oldestQuoteAgeMinutes: 2,
  missingFxPairs: [],
  staleFxPairs: [],
  holdingsWithoutMetadata: [],
  unresolvedImportRows: 0,
  importConflicts: 0,
  unverifiedCalendars: [],
  observedAt: AT,
}

const scan = (over: Partial<DataQualityInput> = {}) => scanDataQuality({ ...clean, ...over })
const categories = (over: Partial<DataQualityInput> = {}) => scan(over).map((i) => i.category)

describe("nothing wrong", () => {
  it("reports nothing, rather than a reassuring score", () => {
    // A single "data quality: 100%" would be a number nobody could reproduce. An empty list is the
    // honest way to say nothing was found.
    expect(scan()).toEqual([])
    expect(worstSeverity([])).toBeNull()
    expect(summariseIssues([])).toEqual({})
  })
})

describe("each category fires on its own condition", () => {
  it("a missing exchange rate is an error, because holdings drop out of the totals", () => {
    const [issue] = scan({ missingFxPairs: ["THB/USD"] })
    expect(issue.category).toBe("MISSING_FX")
    expect(issue.severity).toBe("ERROR")
    expect(issue.title).toContain("THB/USD")
  })

  it("holdings valued at cost are a warning, and are named", () => {
    const [issue] = scan({ holdingsWithoutPrice: [{ symbol: "PTT", market: "SET" }] })
    expect(issue.category).toBe("MISSING_PRICE")
    expect(issue.detail).toContain("PTT")
    expect(issue.count).toBe(1)
  })

  it("lists only the first few names, so one bad provider run does not fill the page", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ symbol: `S${i}`, market: "US" as const }))
    const [issue] = scan({ holdingsWithoutPrice: many })
    expect(issue.count).toBe(9)
    expect(issue.detail).toContain("and others")
  })

  it("an import conflict says explicitly that nothing was changed", () => {
    const [issue] = scan({ importConflicts: 2 })
    expect(issue.category).toBe("IMPORT_CONFLICT")
    expect(issue.detail).toContain("never overwrites")
  })

  it("rejected import rows point at the imports page", () => {
    const [issue] = scan({ unresolvedImportRows: 3 })
    expect(issue).toMatchObject({ category: "IMPORT_UNRESOLVED", count: 3, href: "/imports" })
  })

  it("a delayed price fires only past the threshold", () => {
    expect(categories({ oldestQuoteAgeMinutes: DATA_QUALITY_THRESHOLDS.stalePriceMinutes - 1 }))
      .not.toContain("STALE_PRICE")
    expect(categories({ oldestQuoteAgeMinutes: DATA_QUALITY_THRESHOLDS.stalePriceMinutes }))
      .toContain("STALE_PRICE")
  })

  it("says nothing about price age when nothing was priced", () => {
    expect(categories({ oldestQuoteAgeMinutes: null })).not.toContain("STALE_PRICE")
  })

  it("missing metadata is information, not a fault — the holding is still in the totals", () => {
    const [issue] = scan({ holdingsWithoutMetadata: [{ symbol: "XYZ", market: "US" }] })
    expect(issue.severity).toBe("INFO")
    expect(issue.detail).toContain("Unknown")
  })

  it("an unverified calendar is reported rather than guessed around", () => {
    const [issue] = scan({ unverifiedCalendars: ["SET"] })
    expect(issue.category).toBe("CALENDAR_UNVERIFIED")
    expect(issue.detail).toContain("unknown")
  })
})

describe("ordering and summary", () => {
  it("puts the most severe first", () => {
    const issues = scan({
      missingFxPairs: ["THB/USD"],
      holdingsWithoutPrice: [{ symbol: "PTT", market: "SET" }],
      unresolvedImportRows: 1,
      holdingsWithoutMetadata: [{ symbol: "XYZ", market: "US" }],
    })
    expect(issues.map((i) => i.severity)).toEqual(["ERROR", "WARNING", "NOTICE", "INFO"])
  })

  it("counts by severity, omitting the ones that are absent", () => {
    const issues = scan({ missingFxPairs: ["THB/USD"], unresolvedImportRows: 1 })
    expect(summariseIssues(issues)).toEqual({ ERROR: 1, NOTICE: 1 })
  })

  it("reports the worst severity present", () => {
    expect(worstSeverity(scan({ holdingsWithoutMetadata: [{ symbol: "X", market: "US" }] }))).toBe("INFO")
    expect(worstSeverity(scan({ missingFxPairs: ["THB/USD"] }))).toBe("ERROR")
  })

  it("carries the observation time on every issue", () => {
    for (const issue of scan({ missingFxPairs: ["THB/USD"], unresolvedImportRows: 1 })) {
      expect(issue.observedAt).toBe(AT)
    }
  })

  it("is deterministic", () => {
    const input = { missingFxPairs: ["THB/USD"], importConflicts: 1 }
    expect(scan(input)).toEqual(scan(input))
  })
})
