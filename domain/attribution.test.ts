import { describe, expect, it } from "vitest"
import EN from "@/locales/en/analytics.json"
import TH from "@/locales/th/analytics.json"
import {
  activeReturn,
  attribute,
  ATTRIBUTION_BASIS,
  ATTRIBUTION_UNAVAILABLE,
  describeContribution,
  rankContributors,
  residual,
  type HoldingPeriod,
} from "./attribution"
import { FORBIDDEN_INSIGHT_PATTERNS } from "./insights"

const holding = (overrides: Partial<HoldingPeriod> = {}): HoldingPeriod => ({
  symbol: "NVDA",
  market: "US",
  currency: "USD",
  beginValue: 1_000,
  endValue: 1_200,
  invested: 0,
  divested: 0,
  dividends: 0,
  ...overrides,
})

const ok = (result: ReturnType<typeof attribute>) => {
  if (!result.ok) throw new Error(`expected an attribution, got ${result.reason}`)
  return result
}

describe("the simple case", () => {
  it("attributes a single holding's whole gain to it", () => {
    const result = ok(
      attribute({ beginningValue: 1_000, endingValue: 1_200, netFlow: 0, holdings: [holding()] }),
    )
    expect(result.totalGain).toBe(200)
    expect(result.totalReturnPct).toBeCloseTo(20, 9)
    expect(result.contributions[0].contributionPct).toBeCloseTo(20, 9)
    expect(result.contributions[0].holdingReturnPct).toBeCloseTo(20, 9)
  })

  it("reports its basis, so a screen cannot imply it is time-weighted", () => {
    const result = ok(attribute({ beginningValue: 1_000, endingValue: 1_200, netFlow: 0, holdings: [holding()] }))
    expect(result.basis).toBe(ATTRIBUTION_BASIS)
  })

  it("distinguishes a holding's return from its contribution", () => {
    // The whole reason both numbers exist: a small position up a lot contributes little.
    const result = ok(
      attribute({
        beginningValue: 10_000,
        endingValue: 10_400,
        netFlow: 0,
        holdings: [
          holding({ symbol: "SMALL", beginValue: 200, endValue: 280 }),
          holding({ symbol: "BIG", beginValue: 9_800, endValue: 10_120 }),
        ],
      }),
    )
    const small = result.contributions.find((c) => c.symbol === "SMALL")!
    expect(small.holdingReturnPct).toBeCloseTo(40, 9)
    expect(small.contributionPct).toBeCloseTo(0.8, 9)
  })
})

describe("flows during the period", () => {
  it("does not count a purchase as a gain", () => {
    // The money did not appear, it moved. A naive end − begin would report 100% here.
    const result = ok(
      attribute({
        beginningValue: 1_000,
        endingValue: 2_000,
        netFlow: 1_000,
        holdings: [holding({ beginValue: 1_000, endValue: 2_000, invested: 1_000 })],
      }),
    )
    expect(result.totalGain).toBe(0)
    expect(result.contributions[0].gain).toBe(0)
  })

  it("credits a position bought mid-period only with what it did afterwards", () => {
    const result = ok(
      attribute({
        beginningValue: 1_000,
        endingValue: 1_650,
        netFlow: 500,
        holdings: [
          holding({ symbol: "OLD", beginValue: 1_000, endValue: 1_100 }),
          // Bought for 500, worth 550 at the end: it contributed 50, not 550.
          holding({ symbol: "NEW", beginValue: null, endValue: 550, invested: 500 }),
        ],
      }),
    )
    expect(result.contributions.find((c) => c.symbol === "NEW")!.gain).toBe(50)
    expect(result.totalGain).toBe(150)
  })

  it("credits a position sold mid-period with what it made before it went", () => {
    const result = ok(
      attribute({
        beginningValue: 1_000,
        endingValue: 1_100,
        netFlow: 0,
        // Held 400 at the start, sold for 450, nothing left at the end: a gain of 50.
        holdings: [
          holding({ symbol: "SOLD", beginValue: 400, endValue: null, divested: 450 }),
          holding({ symbol: "KEPT", beginValue: 600, endValue: 650 }),
        ],
      }),
    )
    expect(result.contributions.find((c) => c.symbol === "SOLD")!.gain).toBe(50)
  })

  it("does not treat a deposit as performance", () => {
    const result = ok(
      attribute({ beginningValue: 1_000, endingValue: 2_000, netFlow: 1_000, holdings: [] }),
    )
    expect(result.totalGain).toBe(0)
    expect(result.totalReturnPct).toBe(0)
  })

  it("does not treat a withdrawal as a loss", () => {
    const result = ok(
      attribute({ beginningValue: 1_000, endingValue: 500, netFlow: -500, holdings: [] }),
    )
    expect(result.totalGain).toBe(0)
  })
})

describe("the parts sum to the whole", () => {
  it("has no residual when every holding is measured", () => {
    // Attribution's one checkable property.
    const result = ok(
      attribute({
        beginningValue: 10_000,
        endingValue: 11_500,
        netFlow: 0,
        holdings: [
          holding({ symbol: "A", beginValue: 4_000, endValue: 4_800 }),
          holding({ symbol: "B", beginValue: 3_000, endValue: 3_500 }),
          holding({ symbol: "C", beginValue: 3_000, endValue: 3_200 }),
        ],
      }),
    )
    expect(residual(result)).toBeCloseTo(0, 9)
  })

  it("sums correctly across buys, sells and dividends together", () => {
    /*
     * The fixture has to balance, and writing it is a good check on the methodology. Start 10,000
     * all in stocks. During the period: 1,000 deposited, 800 of it spent on B, 200 of C sold, 100
     * of dividends received from A.
     *
     *   stocks at end   4,500 + 4,100 + 3,500 = 12,100
     *   cash at end     1,000 − 800 + 200 + 100 = 500
     *   ending value    12,600
     *   total gain      12,600 − 10,000 − 1,000 = 1,600
     *
     * and the three holdings gained 600 + 300 + 700 = 1,600. The parts sum to the whole because
     * both sides removed the same external money, not because a weighting was chosen to make them.
     */
    const result = ok(
      attribute({
        beginningValue: 10_000,
        endingValue: 12_600,
        netFlow: 1_000,
        holdings: [
          holding({ symbol: "A", beginValue: 4_000, endValue: 4_500, dividends: 100 }),
          holding({ symbol: "B", beginValue: 3_000, endValue: 4_100, invested: 800 }),
          holding({ symbol: "C", beginValue: 3_000, endValue: 3_500, divested: 200 }),
        ],
      }),
    )
    const summed = result.contributions.reduce((total, c) => total + c.gain, 0)
    expect(summed).toBeCloseTo(result.totalGain, 6)
  })

  it("reports a residual rather than scaling the parts to hide one", () => {
    // A holding that could not be valued leaves a gap. The gap is evidence; hiding it hides the
    // evidence.
    const result = ok(
      attribute({
        beginningValue: 10_000,
        endingValue: 11_000,
        netFlow: 0,
        holdings: [
          holding({ symbol: "A", beginValue: 5_000, endValue: 5_400 }),
          holding({ symbol: "UNKNOWN", beginValue: null, endValue: null }),
        ],
      }),
    )
    expect(result.incompleteSymbols).toEqual(["UNKNOWN"])
    expect(residual(result)).toBeCloseTo(600, 6)
  })
})

describe("income and price", () => {
  it("splits the gain into price and dividends without double counting", () => {
    const result = ok(
      attribute({
        beginningValue: 1_000,
        endingValue: 1_150,
        netFlow: 0,
        holdings: [holding({ beginValue: 1_000, endValue: 1_100, dividends: 50 })],
      }),
    )
    expect(result.dividendGain).toBe(50)
    expect(result.priceGain).toBe(100)
    // The two components are slices of the same total, not additions to it.
    expect(result.priceGain + result.dividendGain).toBeCloseTo(result.totalGain, 9)
  })

  it("does not assume a dividend of zero when none is recorded", () => {
    // Zero dividends *recorded* is what the engine is told; whether the holding actually paid one
    // is a data-coverage question the caller answers, not something invented here.
    const result = ok(attribute({ beginningValue: 1_000, endingValue: 1_100, netFlow: 0, holdings: [holding()] }))
    expect(result.dividendGain).toBe(0)
    expect(result.priceGain).toBe(100)
  })
})

describe("what it refuses to compute", () => {
  it("refuses without a beginning valuation", () => {
    const result = attribute({ beginningValue: null, endingValue: 1_000, netFlow: 0, holdings: [] })
    expect(result).toEqual({ ok: false, reason: "NO_BEGINNING_VALUE" })
  })

  it("refuses without an ending valuation", () => {
    const result = attribute({ beginningValue: 1_000, endingValue: null, netFlow: 0, holdings: [] })
    expect(result).toEqual({ ok: false, reason: "NO_ENDING_VALUE" })
  })

  it("refuses when the portfolio started with nothing", () => {
    // A return on zero is undefined, not infinite, however much it grew to.
    expect(attribute({ beginningValue: 0, endingValue: 5_000, netFlow: 5_000, holdings: [] })).toEqual({
      ok: false,
      reason: "EMPTY_PERIOD",
    })
  })

  it("never reports FX attribution, and says why", () => {
    const result = ok(attribute({ beginningValue: 1_000, endingValue: 1_100, netFlow: 0, holdings: [holding()] }))
    expect(result.fxGain).toBeNull()
    expect(result.fxUnavailableCode).toBe("NO_HISTORICAL_FX")
  })

  /*
   * The sentences live in the translation files now, so the rule is checked there — and in **both**
   * languages, which is a stronger claim than the one this made when there was only English.
   */
  it("gives every unavailable reason a sentence a user can read, in both languages", () => {
    for (const code of ATTRIBUTION_UNAVAILABLE) {
      expect(EN.attribution.unavailable[code]?.length, `en ${code}`).toBeGreaterThan(30)
      expect(TH.attribution.unavailable[code]?.length, `th ${code}`).toBeGreaterThan(20)
    }
  })
})

describe("ranking", () => {
  const contributions = [
    { symbol: "A", market: "US", gain: 500, contributionPct: 5, holdingReturnPct: 10, dividends: 0, incomplete: false },
    { symbol: "B", market: "US", gain: -300, contributionPct: -3, holdingReturnPct: -6, dividends: 0, incomplete: false },
    { symbol: "C", market: "US", gain: 0, contributionPct: 0, holdingReturnPct: 0, dividends: 0, incomplete: false },
    { symbol: "D", market: "US", gain: 0, contributionPct: 0, holdingReturnPct: null, dividends: 0, incomplete: true },
  ]

  it("separates contributors from detractors", () => {
    const { contributors, detractors } = rankContributors(contributions)
    expect(contributors.map((c) => c.symbol)).toEqual(["A"])
    expect(detractors.map((c) => c.symbol)).toEqual(["B"])
  })

  it("excludes a holding that could not be measured from both lists", () => {
    const { contributors, detractors } = rankContributors(contributions)
    expect([...contributors, ...detractors].some((c) => c.symbol === "D")).toBe(false)
  })

  it("excludes a flat holding from both, because it neither added nor removed", () => {
    const { contributors, detractors } = rankContributors(contributions)
    expect([...contributors, ...detractors].some((c) => c.symbol === "C")).toBe(false)
  })
})

describe("the sentences describe and never advise", () => {
  it("reports what a holding did, in the past tense, as facts rather than prose", () => {
    const facts = describeContribution(
      { symbol: "TSLA", market: "US", gain: -140, contributionPct: -1.4, holdingReturnPct: -12, dividends: 0, incomplete: false },
      "USD",
    )
    expect(facts).toEqual({
      incomplete: false,
      symbol: "TSLA",
      direction: "removed",
      points: "1.40",
      amount: "140.00",
      currency: "USD",
    })
  })

  it("uses none of the forbidden vocabulary, in either language", () => {
    // The same list the insights engine is held to: no buy, sell, hold, rating, target or forecast.
    // Applied to the messages themselves, so a translation cannot smuggle in advice the English
    // never had — which is the failure mode a bilingual application adds.
    const sentences = [
      ...Object.values(EN.attribution.unavailable),
      ...Object.values(TH.attribution.unavailable),
      ...Object.values(EN.attribution.contribution),
      ...Object.values(TH.attribution.contribution),
    ]
    for (const sentence of sentences) {
      for (const pattern of FORBIDDEN_INSIGHT_PATTERNS) {
        expect(pattern.test(sentence), `"${sentence}" matched ${pattern}`).toBe(false)
      }
    }
  })
})

describe("active return", () => {
  const base = { portfolioCurrency: "USD" as const, benchmarkCurrency: "USD" as const }

  it("subtracts the benchmark from the portfolio", () => {
    const result = activeReturn({ ...base, portfolioReturnPct: 8.2, benchmarkReturnPct: 6.5 })
    expect(result.activeReturnPct).toBeCloseTo(1.7, 9)
    expect(result.reason).toBeNull()
  })

  it("refuses across currencies, and says why", () => {
    const result = activeReturn({
      portfolioReturnPct: 8.2,
      benchmarkReturnPct: 6.5,
      portfolioCurrency: "THB",
      benchmarkCurrency: "USD",
    })
    expect(result.activeReturnPct).toBeNull()
    expect(result.reason).toContain("historical exchange rate")
    // Both returns are still reported; only the difference is withheld.
    expect(result.portfolioReturnPct).toBe(8.2)
    expect(result.benchmarkReturnPct).toBe(6.5)
  })

  it("refuses when either return is missing", () => {
    expect(activeReturn({ ...base, portfolioReturnPct: null, benchmarkReturnPct: 6.5 }).activeReturnPct).toBeNull()
    expect(activeReturn({ ...base, portfolioReturnPct: 8.2, benchmarkReturnPct: null }).activeReturnPct).toBeNull()
  })
})
