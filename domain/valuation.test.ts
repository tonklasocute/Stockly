import { describe, expect, it } from "vitest"
import { computeValuation, MIN_VALUATION_HISTORY, valuationContext, VALUATION_DISCLAIMER } from "./valuation"
import { FORBIDDEN_INSIGHT_PATTERNS } from "./insights"
import type { FinancialStatement } from "./fundamentals"

const statement = (overrides: Partial<FinancialStatement> = {}): FinancialStatement => ({
  symbol: "NVDA",
  market: "US",
  period: { type: "TTM", fiscalYear: 2026, fiscalQuarter: null, reportDate: null, periodEnd: "2026-06-30" },
  currency: "USD",
  income: { revenue: 1_000, grossProfit: 700, operatingIncome: 400, ebitda: 450, netIncome: 300, eps: 3, epsDiluted: 2.5, sharesDiluted: 100 },
  balance: { totalAssets: 2_000, totalLiabilities: 800, totalEquity: 1_200, cashAndEquivalents: 500, totalDebt: 300, currentAssets: 900, currentLiabilities: 400 },
  cashFlow: { operatingCashFlow: 450, capitalExpenditure: -150, investingCashFlow: null, financingCashFlow: null, dividendsPaid: -50 },
  source: "mock",
  fetchedAt: "2026-09-03T00:00:00.000Z",
  ...overrides,
})

const inputs = (overrides = {}) => ({
  price: 50,
  sharesOutstanding: 100,
  statement: statement(),
  dividendPerShare: 1.5,
  priceCurrency: "USD" as const,
  ...overrides,
})

describe("multiples", () => {
  const valuation = computeValuation(inputs())

  it("computes each one against the reported figures", () => {
    // Price 50, diluted EPS 2.5 → 20. Revenue per share 10 → P/S 5. Book 12 → P/B 4.17.
    expect(valuation.priceToEarnings).toBeCloseTo(20, 9)
    expect(valuation.priceToSales).toBeCloseTo(5, 9)
    expect(valuation.priceToBook).toBeCloseTo(50 / 12, 6)
  })

  it("prefers diluted EPS, which is the more conservative figure", () => {
    expect(valuation.priceToEarnings).toBeCloseTo(50 / 2.5, 9)
  })

  it("computes enterprise value only when every input is present", () => {
    // 5,000 market cap + 300 debt − 500 cash.
    expect(valuation.enterpriseValue).toBe(4_800)
    const missingCash = computeValuation(
      inputs({ statement: statement({ balance: { ...statement().balance, cashAndEquivalents: null } }) }),
    )
    // A partial EV overstates the figure and a reader cannot tell.
    expect(missingCash.enterpriseValue).toBeNull()
    expect(missingCash.evToEbitda).toBeNull()
  })

  it("carries the period, so a multiple is never shown unlabelled", () => {
    expect(valuation.periodLabel).toBe("TTM")
  })
})

describe("what it refuses to compute", () => {
  it("has no P/E for a loss-making company, rather than a negative one", () => {
    // A negative P/E would let "P/E < 10" match every loss-making company in the market.
    const loss = computeValuation(
      inputs({ statement: statement({ income: { ...statement().income, eps: -2, epsDiluted: -2 } }) }),
    )
    expect(loss.priceToEarnings).toBeNull()
  })

  it("still reports an earnings yield for a loss, because that stays readable", () => {
    const loss = computeValuation(
      inputs({ statement: statement({ income: { ...statement().income, eps: -2, epsDiluted: -2 } }) }),
    )
    expect(loss.earningsYield).toBeCloseTo(-4, 9)
  })

  it("has no price-to-FCF when free cash flow is negative", () => {
    const burning = computeValuation(
      inputs({ statement: statement({ cashFlow: { ...statement().cashFlow, operatingCashFlow: 50, capitalExpenditure: -400 } }) }),
    )
    expect(burning.priceToFreeCashFlow).toBeNull()
    // The yield still says what happened: the company consumed cash.
    expect(burning.freeCashFlowYield).toBeLessThan(0)
  })

  it("computes nothing without a statement, and says why", () => {
    const none = computeValuation(inputs({ statement: null }))
    expect(none.priceToEarnings).toBeNull()
    expect(none.unavailableReason).toContain("No financial statements")
  })

  it("computes nothing without a price", () => {
    const none = computeValuation(inputs({ price: null }))
    expect(none.unavailableReason).toContain("No current price")
  })

  it("refuses when the shares trade in one currency and the company reports in another", () => {
    // Every multiple would be mostly an exchange rate.
    const mismatch = computeValuation(inputs({ statement: statement({ currency: "THB" }) }))
    expect(mismatch.priceToEarnings).toBeNull()
    expect(mismatch.currencyMismatch).toEqual({ price: "USD", reporting: "THB" })
    expect(mismatch.unavailableReason).toContain("exchange rate")
  })

  it("has no market cap without a share count", () => {
    const noShares = computeValuation(inputs({ sharesOutstanding: null }))
    expect(noShares.marketCap).toBeNull()
    expect(noShares.priceToSales).toBeNull()
  })

  it("never exposes a forward multiple field at all", () => {
    // The strongest guarantee that a forward estimate is never invented: nowhere to put one.
    expect("forwardPE" in computeValuation(inputs())).toBe(false)
    expect("forwardPriceToEarnings" in computeValuation(inputs())).toBe(false)
  })
})

describe("yields", () => {
  it("computes a dividend yield from trailing payments", () => {
    expect(computeValuation(inputs()).dividendYield).toBeCloseTo(3, 9)
  })

  it("has no dividend yield when nothing was paid, rather than reporting zero", () => {
    // Zero implies a measured yield of nothing; null says the payments are unknown.
    expect(computeValuation(inputs({ dividendPerShare: null })).dividendYield).toBeNull()
  })
})

describe("historical context", () => {
  const history = [18, 20, 22, 19, 25, 21, 23, 20, 24, 19]

  it("reports the median, range and distance from it", () => {
    const context = valuationContext(28, history, "P/E")
    expect(context.median).toBeCloseTo(20.5, 6)
    expect(context.low).toBe(18)
    expect(context.high).toBe(25)
    expect(context.vsMedianPct).toBeGreaterThan(0)
  })

  it("refuses below the minimum sample rather than calling three readings a median", () => {
    const thin = valuationContext(28, [18, 20, 22], "P/E")
    expect(thin.median).toBeNull()
    expect(thin.description).toBeNull()
    expect(MIN_VALUATION_HISTORY).toBeGreaterThan(3)
  })

  it("ignores null and non-positive observations", () => {
    const dirty = valuationContext(28, [...history, null, -5, 0], "P/E")
    expect(dirty.observations).toBe(history.length)
  })

  it("states a comparison and never a judgement", () => {
    const context = valuationContext(15, history, "P/E")
    expect(context.description).toContain("below its median")
    // Not "undervalued", "cheap", or anything implying an action.
    expect(context.description).not.toContain("undervalued")
    expect(context.description).not.toContain("cheap")
  })
})

describe("the wording describes and never advises", () => {
  it("uses none of the forbidden vocabulary", () => {
    const sentences = [
      valuationContext(15, [18, 20, 22, 19, 25, 21, 23, 20, 24, 19], "P/E").description!,
      valuationContext(30, [18, 20, 22, 19, 25, 21, 23, 20, 24, 19], "P/E").description!,
      computeValuation(inputs({ statement: statement({ currency: "THB" }) })).unavailableReason!,
      computeValuation(inputs({ statement: null })).unavailableReason!,
      VALUATION_DISCLAIMER,
    ]
    for (const sentence of sentences) {
      for (const pattern of FORBIDDEN_INSIGHT_PATTERNS) {
        expect(pattern.test(sentence), `"${sentence}" matched ${pattern}`).toBe(false)
      }
    }
  })

  it("says outright that a multiple is a comparison rather than a judgement", () => {
    expect(VALUATION_DISCLAIMER).toContain("not a judgement")
  })
})
