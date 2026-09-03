import { describe, expect, it } from "vitest"
import EN_ENUMS from "@/locales/en/enums.json"
import TH_ENUMS from "@/locales/th/enums.json"
import {
  CROSSABLE_METRICS,
  FUNDAMENTAL_METRICS,
  isFundamentalMetric,
  matchesFilter,
  readMetric,
  SCREENER_METRICS,
  type ScreenerContext,
} from "./screener"
import type { TechnicalSnapshot } from "./technical"

/**
 * The fundamental half of the existing screener.
 *
 * The behaviour that matters most is what happens when fundamentals are *absent* — which is the
 * normal case for a deployment with no fundamentals provider, and the case a careless
 * implementation gets backwards by matching everything.
 */

const snapshot: TechnicalSnapshot = {
  symbol: "NVDA",
  market: "US",
  price: 100,
  rsi: 55,
  adx: 22,
  atrPct: 2.1,
  score: 60,
  macd: 1,
  macdSignal: 0.8,
  macdHistogram: 0.2,
  macdCross: null,
  emaCross50200: null,
  ema: { 50: 95, 200: 90 },
  sma: { 200: 92 },
  relativeVolume: 1.2,
  trend: "UP",
  calculatedAt: "2026-09-03T00:00:00.000Z",
  sourceTimestamp: "2026-09-02T20:00:00.000Z",
} as unknown as TechnicalSnapshot

const withFundamentals: ScreenerContext = {
  marketCap: 1_000_000,
  volume: 500_000,
  fundamentals: {
    revenueGrowth: 18,
    epsGrowth: 25,
    grossMargin: 62,
    operatingMargin: 34,
    netMargin: 28,
    returnOnEquity: 22,
    returnOnAssets: 14,
    fcfMargin: 24,
    debtToEquity: 0.35,
    currentRatio: 2.4,
    priceToEarnings: 28,
    priceToSales: 9,
    priceToBook: 12,
    evToEbitda: 21,
    dividendYield: 0.4,
    payoutRatio: 12,
  },
}

const withoutFundamentals: ScreenerContext = { marketCap: 1_000_000, volume: 500_000 }
const nullFundamentals: ScreenerContext = {
  marketCap: null,
  volume: null,
  fundamentals: { ...withFundamentals.fundamentals!, netMargin: null, priceToEarnings: null },
}

describe("the fundamental metrics live in the same screener", () => {
  it("are members of the one metric enum", () => {
    for (const metric of FUNDAMENTAL_METRICS) {
      expect(SCREENER_METRICS).toContain(metric)
    }
  })

  it("are identifiable, so the UI can disable them without a provider", () => {
    expect(isFundamentalMetric("NET_MARGIN")).toBe(true)
    expect(isFundamentalMetric("RSI")).toBe(false)
  })

  it("each carry a label naming its period, never a bare multiple", () => {
    for (const metric of FUNDAMENTAL_METRICS) {
      expect(EN_ENUMS.screenerMetric[metric].length, `en ${metric}`).toBeGreaterThan(0)
      expect(TH_ENUMS.screenerMetric[metric].length, `th ${metric}`).toBeGreaterThan(0)
    }
    // A multiple without its period is the thing a reader misreads.
    // A period is part of a figure, in both languages: "P/E" bare is never shown.
    expect(EN_ENUMS.screenerMetric.PE_RATIO).toContain("TTM")
    expect(TH_ENUMS.screenerMetric.PE_RATIO).toContain("12 เดือนย้อนหลัง")
    expect(EN_ENUMS.screenerMetric.REVENUE_GROWTH).toContain("YoY")
    expect(TH_ENUMS.screenerMetric.REVENUE_GROWTH).toContain("เทียบปีก่อน")
  })

  it("offer crossing operators only where a crossing exists", () => {
    // "P/E crossed above 20" is not a thing; the metric has no series to cross.
    for (const metric of FUNDAMENTAL_METRICS) {
      expect(CROSSABLE_METRICS).not.toContain(metric)
    }
  })
})

describe("reading a fundamental metric", () => {
  it("reads the value when it is there", () => {
    expect(readMetric(snapshot, withFundamentals, "NET_MARGIN")).toBe(28)
    expect(readMetric(snapshot, withFundamentals, "PE_RATIO")).toBe(28)
    expect(readMetric(snapshot, withFundamentals, "DEBT_TO_EQUITY")).toBe(0.35)
  })

  it("is null when the deployment has no fundamentals at all", () => {
    for (const metric of FUNDAMENTAL_METRICS) {
      expect(readMetric(snapshot, withoutFundamentals, metric), metric).toBeNull()
    }
  })

  it("is null for the individual metrics a company does not report", () => {
    expect(readMetric(snapshot, nullFundamentals, "NET_MARGIN")).toBeNull()
    // Others in the same context still read.
    expect(readMetric(snapshot, nullFundamentals, "GROSS_MARGIN")).toBe(62)
  })
})

describe("filtering", () => {
  it("matches on a fundamental filter", () => {
    expect(matchesFilter(snapshot, withFundamentals, { metric: "NET_MARGIN", operator: "GT", value: 20 })).toBe(true)
    expect(matchesFilter(snapshot, withFundamentals, { metric: "NET_MARGIN", operator: "LT", value: 20 })).toBe(false)
  })

  it("excludes rather than includes when a fundamental is unknown", () => {
    /*
     * The conservative direction, and the important one. A stock Stockly knows nothing about must
     * not appear in a screen for "net margin > 20%" — including it would put unscreened companies
     * in a screened list, which is worse than a shorter list.
     */
    expect(matchesFilter(snapshot, withoutFundamentals, { metric: "NET_MARGIN", operator: "GT", value: 20 })).toBe(false)
    expect(matchesFilter(snapshot, withoutFundamentals, { metric: "NET_MARGIN", operator: "LT", value: 20 })).toBe(false)
  })

  it("excludes on both sides of a comparison, so a filter cannot be inverted to find them", () => {
    expect(matchesFilter(snapshot, nullFundamentals, { metric: "PE_RATIO", operator: "LT", value: 100 })).toBe(false)
    expect(matchesFilter(snapshot, nullFundamentals, { metric: "PE_RATIO", operator: "GT", value: 0 })).toBe(false)
  })

  it("combines a technical and a fundamental filter in one screen", () => {
    // The whole reason these live in one enum: this is one question, not two.
    const technical = matchesFilter(snapshot, withFundamentals, { metric: "RSI", operator: "LT", value: 60 })
    const fundamental = matchesFilter(snapshot, withFundamentals, { metric: "PE_RATIO", operator: "LT", value: 30 })
    expect(technical && fundamental).toBe(true)
  })

  it("still runs a technical filter when fundamentals are absent", () => {
    expect(matchesFilter(snapshot, withoutFundamentals, { metric: "RSI", operator: "LT", value: 60 })).toBe(true)
  })
})
