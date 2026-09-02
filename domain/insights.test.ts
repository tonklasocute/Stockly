import { describe, expect, it } from "vitest"
import {
  INSIGHT_THRESHOLDS,
  buildInsights,
  findForbiddenPattern,
  type InsightFacts,
} from "./insights"

const empty: InsightFacts = {
  baseCurrency: "USD",
  concentration: null,
  returnPct: null,
  currentDrawdownPct: null,
  maxDrawdownPct: null,
  benchmark: null,
  cash: null,
  currencyExposure: [],
  untranslatedHoldings: 0,
  dividends: null,
  fees: null,
  trades: null,
  staleHoldings: 0,
  quoteAgeMinutes: null,
}

const facts = (over: Partial<InsightFacts> = {}): InsightFacts => ({ ...empty, ...over })
const codes = (f: InsightFacts) => buildInsights(f).map((i) => i.code)
const find = (f: InsightFacts, code: string) => buildInsights(f).find((i) => i.code === code)

describe("no facts, no insights", () => {
  it("says nothing at all about an empty portfolio", () => {
    // The alternative — inventing a reassuring INFO — would be a claim about a portfolio that
    // does not exist yet.
    expect(buildInsights(empty)).toEqual([])
  })

  it("emits nothing from a rule whose input is null", () => {
    expect(codes(facts({ concentration: null, currentDrawdownPct: null }))).toEqual([])
  })
})

describe("concentration", () => {
  const concentrated = (largest: number) =>
    facts({
      concentration: {
        largestSymbol: "NVDA",
        largestWeightPct: largest,
        topThreeWeightPct: largest + 10,
        effectivePositions: 5,
        positions: 8,
      },
    })

  it("is silent below the notice threshold", () => {
    expect(codes(concentrated(INSIGHT_THRESHOLDS.concentration.largestPositionNoticePct - 0.1)))
      .not.toContain("CONCENTRATION_LARGEST")
  })

  it("notices at the threshold and warns at the higher one", () => {
    expect(find(concentrated(INSIGHT_THRESHOLDS.concentration.largestPositionNoticePct), "CONCENTRATION_LARGEST")!.severity)
      .toBe("NOTICE")
    expect(find(concentrated(INSIGHT_THRESHOLDS.concentration.largestPositionWarningPct), "CONCENTRATION_LARGEST")!.severity)
      .toBe("WARNING")
  })

  it("names the position and the figure it fired on", () => {
    const insight = find(concentrated(41), "CONCENTRATION_LARGEST")!
    expect(insight.title).toContain("NVDA")
    expect(insight.metric).toEqual({ label: "Largest position", value: "41%" })
  })

  it("reports effective positions only when there are more positions than that", () => {
    const many = facts({
      concentration: { largestSymbol: "A", largestWeightPct: 5, topThreeWeightPct: 12, effectivePositions: 2, positions: 20 },
    })
    expect(codes(many)).toContain("CONCENTRATION_EFFECTIVE")

    const few = facts({
      concentration: { largestSymbol: "A", largestWeightPct: 60, topThreeWeightPct: 100, effectivePositions: 2, positions: 3 },
    })
    expect(codes(few)).not.toContain("CONCENTRATION_EFFECTIVE")
  })
})

describe("drawdown", () => {
  it("is silent below the notice threshold", () => {
    expect(codes(facts({ currentDrawdownPct: INSIGHT_THRESHOLDS.drawdown.currentNoticePct - 0.1 })))
      .not.toContain("DRAWDOWN_CURRENT")
  })

  it("escalates from notice to warning at the stated levels", () => {
    expect(find(facts({ currentDrawdownPct: 12 }), "DRAWDOWN_CURRENT")!.severity).toBe("NOTICE")
    expect(find(facts({ currentDrawdownPct: 25 }), "DRAWDOWN_CURRENT")!.severity).toBe("WARNING")
  })

  it("mentions the maximum when it is known, and omits it when it is not", () => {
    expect(find(facts({ currentDrawdownPct: 25, maxDrawdownPct: 31 }), "DRAWDOWN_CURRENT")!.detail)
      .toContain("31%")
    expect(find(facts({ currentDrawdownPct: 25 }), "DRAWDOWN_CURRENT")!.detail)
      .not.toContain("deepest")
  })
})

describe("benchmark", () => {
  const compared = (portfolio: number, bench: number) =>
    facts({ benchmark: { name: "S&P 500", portfolioReturnPct: portfolio, benchmarkReturnPct: bench } })

  it("says nothing when the two are close", () => {
    expect(codes(compared(10, 8))).not.toContain("BENCHMARK_BEHIND")
    expect(codes(compared(10, 8))).not.toContain("BENCHMARK_AHEAD")
  })

  it("notices a lag past the threshold", () => {
    const insight = find(compared(3, 10), "BENCHMARK_BEHIND")!
    expect(insight.severity).toBe("NOTICE")
    expect(insight.title).toContain("S&P 500")
    expect(insight.metric!.value).toBe("-7%")
  })

  it("reports a lead as information, not praise", () => {
    expect(find(compared(15, 8), "BENCHMARK_AHEAD")!.severity).toBe("INFO")
  })

  it("states that the comparison is time-weighted, so a deposit cannot flatter it", () => {
    expect(find(compared(3, 10), "BENCHMARK_BEHIND")!.detail).toContain("Time-weighted")
  })
})

describe("cash and currency", () => {
  it("flags a negative recorded balance and explains what causes it", () => {
    const insight = find(facts({ cash: { balance: -500, sharePct: null } }), "CASH_NEGATIVE")!
    expect(insight.severity).toBe("NOTICE")
    expect(insight.detail).toContain("deposits")
  })

  it("mentions a high cash share as information", () => {
    expect(find(facts({ cash: { balance: 10_000, sharePct: 30 } }), "CASH_HIGH_SHARE")!.severity).toBe("INFO")
    expect(codes(facts({ cash: { balance: 10_000, sharePct: 5 } }))).not.toContain("CASH_HIGH_SHARE")
  })

  it("names a large foreign-currency exposure and never the base currency", () => {
    const f = facts({
      currencyExposure: [
        { currency: "USD", weightPct: 60 },
        { currency: "THB", weightPct: 40 },
      ],
    })
    expect(codes(f)).toContain("CURRENCY_EXPOSURE_THB")
    expect(codes(f)).not.toContain("CURRENCY_EXPOSURE_USD")
  })

  it("skips an exposure whose weight could not be computed", () => {
    expect(codes(facts({ currencyExposure: [{ currency: "THB", weightPct: null }] }))).toEqual([])
  })
})

describe("data quality comes first", () => {
  it("warns that holdings are missing from the totals, above everything else", () => {
    const insights = buildInsights(
      facts({ untranslatedHoldings: 2, currentDrawdownPct: 25, returnPct: 5 }),
    )
    expect(insights[0].code).toBe("DATA_NO_FX")
    expect(insights[0].severity).toBe("WARNING")
  })

  it("notices holdings valued at cost", () => {
    expect(find(facts({ staleHoldings: 3 }), "DATA_STALE_PRICES")!.detail).toContain("3 holdings")
  })

  it("states the quote age only once it is actually delayed", () => {
    expect(codes(facts({ quoteAgeMinutes: 5 }))).not.toContain("DATA_QUOTE_AGE")
    expect(find(facts({ quoteAgeMinutes: 42 }), "DATA_QUOTE_AGE")!.detail).toContain("42 minutes")
  })
})

describe("fees, win rate and dividends", () => {
  it("notices fees only past the stated share of turnover", () => {
    expect(codes(facts({ fees: { total: 100, percentOfTurnover: 0.4 } }))).not.toContain("FEES_SHARE_OF_TURNOVER")
    expect(find(facts({ fees: { total: 900, percentOfTurnover: 1.8 } }), "FEES_SHARE_OF_TURNOVER")!.severity)
      .toBe("NOTICE")
  })

  it("says nothing about a win rate below the minimum sample", () => {
    expect(codes(facts({ trades: { closed: 4, winRatePct: 25 } }))).not.toContain("WIN_RATE_LOW")
    expect(codes(facts({ trades: { closed: 20, winRatePct: 25 } }))).toContain("WIN_RATE_LOW")
  })

  it("explains that a win rate counts decisions rather than amounts", () => {
    expect(find(facts({ trades: { closed: 20, winRatePct: 25 } }), "WIN_RATE_LOW")!.detail)
      .toContain("not amounts")
  })

  it("reports a dividend change in either direction, and nothing without a prior year", () => {
    expect(find(facts({ dividends: { trailingTwelveMonths: 1500, previousTwelveMonths: 1000 } }), "DIVIDEND_CHANGE")!.title)
      .toContain("higher")
    expect(find(facts({ dividends: { trailingTwelveMonths: 500, previousTwelveMonths: 1000 } }), "DIVIDEND_CHANGE")!.title)
      .toContain("lower")
    expect(codes(facts({ dividends: { trailingTwelveMonths: 1500, previousTwelveMonths: null } }))).toEqual([])
    expect(codes(facts({ dividends: { trailingTwelveMonths: 1020, previousTwelveMonths: 1000 } }))).toEqual([])
  })
})

describe("ordering", () => {
  it("puts warnings before notices before information", () => {
    const insights = buildInsights(
      facts({
        untranslatedHoldings: 1,
        currentDrawdownPct: 12,
        returnPct: 5,
        concentration: { largestSymbol: "NVDA", largestWeightPct: 45, topThreeWeightPct: 70, effectivePositions: 3, positions: 6 },
      }),
    )
    const severities = insights.map((i) => i.severity)
    expect(severities).toEqual([...severities].sort((a, b) => {
      const order = { WARNING: 0, NOTICE: 1, INFO: 2 } as const
      return order[a] - order[b]
    }))
  })
})

describe("the engine cannot give advice", () => {
  /**
   * Every insight the engine can produce, from facts chosen to fire every single rule. A prompt is
   * a request; a check is a guarantee — and this is the check.
   */
  const everything = buildInsights({
    baseCurrency: "USD",
    concentration: { largestSymbol: "NVDA", largestWeightPct: 45, topThreeWeightPct: 78, effectivePositions: 2.4, positions: 12 },
    returnPct: -14.2,
    currentDrawdownPct: 26.5,
    maxDrawdownPct: 31.9,
    benchmark: { name: "S&P 500", portfolioReturnPct: -3.1, benchmarkReturnPct: 11.4 },
    cash: { balance: -820.5, sharePct: 31 },
    currencyExposure: [
      { currency: "USD", weightPct: 55 },
      { currency: "THB", weightPct: 45 },
    ],
    untranslatedHoldings: 2,
    dividends: { trailingTwelveMonths: 400, previousTwelveMonths: 1000 },
    fees: { total: 1420, percentOfTurnover: 2.4 },
    trades: { closed: 31, winRatePct: 29 },
    staleHoldings: 4,
    quoteAgeMinutes: 61,
  })

  it("fires every rule in this fixture, so the check below covers all of them", () => {
    const types = new Set(everything.map((i) => i.type))
    expect(types).toContain("CONCENTRATION")
    expect(types).toContain("DRAWDOWN")
    expect(types).toContain("BENCHMARK")
    expect(types).toContain("CASH")
    expect(types).toContain("CURRENCY")
    expect(types).toContain("PERFORMANCE")
    expect(types).toContain("FEES")
    expect(types).toContain("WIN_RATE")
    expect(types).toContain("DIVIDEND")
    expect(types).toContain("DATA")
    expect(everything.length).toBeGreaterThanOrEqual(10)
  })

  it("uses no instruction, rating or forecast vocabulary anywhere", () => {
    for (const insight of everything) {
      for (const text of [insight.title, insight.detail, insight.metric?.label ?? ""]) {
        const offender = findForbiddenPattern(text)
        expect(offender, `"${text}" matched ${offender}`).toBeNull()
      }
    }
  })

  it("recognises advice when it sees it, so the check above is not vacuous", () => {
    expect(findForbiddenPattern("You should sell NVDA.")).not.toBeNull()
    expect(findForbiddenPattern("NVDA is overvalued.")).not.toBeNull()
    expect(findForbiddenPattern("The price will rise next quarter.")).not.toBeNull()
    expect(findForbiddenPattern("Consider trimming this position.")).not.toBeNull()
    expect(findForbiddenPattern("NVDA is 41% of the portfolio.")).toBeNull()
  })
})
