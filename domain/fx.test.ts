import { describe, expect, it } from "vitest"
import {
  FX_STALE_AFTER_MS,
  buildFxTable,
  convert,
  converterTo,
  findRate,
  fxFreshness,
  fxPair,
  identityConverter,
  type FxRate,
} from "./fx"

const NOW = new Date("2026-09-02T12:00:00Z")
const FRESH = "2026-09-02T11:45:00Z" // 15 minutes old
const STALE = "2026-09-02T09:00:00Z" // 3 hours old
const ANCIENT = "2026-08-30T12:00:00Z" // 3 days old

const rate = (over: Partial<FxRate> = {}): FxRate => ({
  base: "USD",
  quote: "THB",
  rate: 32.45,
  asOf: FRESH,
  provider: "mock",
  ...over,
})

describe("freshness", () => {
  it("is fresh inside the window and stale outside it", () => {
    expect(fxFreshness({ asOf: FRESH }, NOW)).toBe("fresh")
    expect(fxFreshness({ asOf: STALE }, NOW)).toBe("stale")
  })

  it("is unavailable past a day — a rate that old is wrong, not merely late", () => {
    expect(fxFreshness({ asOf: ANCIENT }, NOW)).toBe("unavailable")
  })

  it("is unavailable when the timestamp cannot be read at all", () => {
    // A rate we cannot date is a rate we cannot vouch for.
    expect(fxFreshness({ asOf: "not a date" }, NOW)).toBe("unavailable")
  })

  it("uses a one-hour threshold by default", () => {
    const justInside = new Date(NOW.getTime() - FX_STALE_AFTER_MS + 1000).toISOString()
    expect(fxFreshness({ asOf: justInside }, NOW)).toBe("fresh")
  })
})

describe("rate lookup", () => {
  const table = buildFxTable([rate()])

  it("finds a direct pair", () => {
    expect(findRate(table, "USD", "THB")?.rate).toBe(32.45)
  })

  it("inverts a pair rather than spending a second upstream call on it", () => {
    const inverted = findRate(table, "THB", "USD")
    expect(inverted?.rate).toBeCloseTo(1 / 32.45, 9)
    // The inverted rate inherits the timestamp it was derived from; it is no fresher than its source.
    expect(inverted?.asOf).toBe(FRESH)
  })

  it("refuses to triangulate — a synthesised rate is one no provider would stand behind", () => {
    const withEur = buildFxTable([rate(), rate({ base: "USD", quote: "EUR", rate: 0.92 })])
    expect(findRate(withEur, "EUR", "THB")).toBeNull()
  })

  it("discards a nonsensical rate rather than storing it", () => {
    expect(findRate(buildFxTable([rate({ rate: 0 })]), "USD", "THB")).toBeNull()
    expect(findRate(buildFxTable([rate({ rate: -1 })]), "USD", "THB")).toBeNull()
    expect(findRate(buildFxTable([rate({ rate: Number.NaN })]), "USD", "THB")).toBeNull()
  })

  it("reports the pairs it was asked for and could not answer", () => {
    expect(buildFxTable([], [fxPair("THB", "USD")]).missing).toEqual(["THB/USD"])
  })
})

describe("convert", () => {
  const table = buildFxTable([rate()])

  it("passes an amount through unchanged when the currencies match", () => {
    const same = convert(100, "USD", "USD", buildFxTable([]), NOW)
    expect(same).toMatchObject({ value: 100, rate: 1, identity: true, freshness: "fresh" })
    // No provider was consulted, so there is no timestamp to report.
    expect(same?.asOf).toBeNull()
  })

  it("converts USD to THB", () => {
    expect(convert(100, "USD", "THB", table, NOW)?.value).toBeCloseTo(3245, 6)
  })

  it("converts THB to USD through the inverted rate", () => {
    expect(convert(3245, "THB", "USD", table, NOW)?.value).toBeCloseTo(100, 4)
  })

  it("returns null — never 0 — when there is no rate for the pair", () => {
    expect(convert(100, "EUR", "THB", table, NOW)).toBeNull()
  })

  it("still converts on a stale rate, but says it is stale", () => {
    const staleTable = buildFxTable([rate({ asOf: STALE })])
    expect(convert(100, "USD", "THB", staleTable, NOW)).toMatchObject({
      value: 3245,
      freshness: "stale",
    })
  })

  it("refuses to convert on a rate too old to vouch for", () => {
    const oldTable = buildFxTable([rate({ asOf: ANCIENT })])
    expect(convert(100, "USD", "THB", oldTable, NOW)).toBeNull()
  })

  it("returns null for a non-finite amount rather than producing NaN", () => {
    expect(convert(Number.NaN, "USD", "THB", table, NOW)).toBeNull()
    expect(convert(Number.POSITIVE_INFINITY, "USD", "THB", table, NOW)).toBeNull()
  })
})

describe("converters", () => {
  it("binds a target currency and an instant", () => {
    const toThb = converterTo("THB", buildFxTable([rate()]), NOW)
    expect(toThb(10, "USD")?.value).toBeCloseTo(324.5, 6)
    expect(toThb(10, "THB")?.identity).toBe(true)
  })

  it("the identity converter passes its own currency and refuses every other", () => {
    const identity = identityConverter("USD")
    expect(identity(10, "USD")).toMatchObject({ value: 10, rate: 1, identity: true })
    // No FX layer wired in means no conversion — not a conversion at par.
    expect(identity(10, "THB")).toBeNull()
  })
})
