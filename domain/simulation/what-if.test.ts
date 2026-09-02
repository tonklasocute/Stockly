import { describe, expect, it } from "vitest"
import { simulateWhatIf, uniformPriceShock } from "./what-if"
import type { Holding } from "../types"

/** A holding as the engine produces one, defaulting to the US/USD identity case. */
const holding = (over: Partial<Holding> = {}): Holding => {
  const quantity = over.quantity ?? 10
  const price = over.currentPrice ?? 180
  const invested = over.investedValue ?? 1700
  const base: Holding = {
    symbol: "NVDA",
    market: "US",
    currency: "USD",
    quantity,
    investedValue: invested,
    averageCost: quantity > 0 ? invested / quantity : 0,
    realizedPnl: 0,
    currentPrice: price,
    marketValue: quantity * price,
    unrealizedPnl: quantity * price - invested,
    returnPct: 0,
    weight: null,
    todayPnl: null,
    todayReturnPct: null,
    stale: false,
    baseCurrency: "USD",
    fx: { rate: 1, asOf: null, freshness: "fresh", identity: true },
    baseMarketValue: quantity * price,
    baseInvestedValue: invested,
    baseUnrealizedPnl: quantity * price - invested,
    baseTodayPnl: null,
    baseRealizedPnl: 0,
    ...over,
  }
  return base
}

const thaiHolding = (over: Partial<Holding> = {}) =>
  holding({
    symbol: "PTT",
    market: "SET",
    currency: "THB",
    quantity: 1000,
    currentPrice: 32,
    investedValue: 30_000,
    marketValue: 32_000,
    baseCurrency: "USD",
    fx: { rate: 1 / 32.45, asOf: "2026-09-02T11:00:00Z", freshness: "fresh", identity: false },
    baseMarketValue: 32_000 / 32.45,
    baseInvestedValue: 30_000 / 32.45,
    ...over,
  })

const run = (over: Partial<Parameters<typeof simulateWhatIf>[0]> = {}) =>
  simulateWhatIf({
    holdings: [holding()],
    baseCurrency: "USD",
    cash: 5000,
    cashDelta: 0,
    priceAdjustments: [],
    quantityAdjustments: [],
    ...over,
  })

describe("no adjustments", () => {
  it("restates the portfolio exactly as it stands", () => {
    const result = run()
    expect(result.scenarioTotal).toBe(result.currentTotal)
    expect(result.difference).toBe(0)
    expect(result.holdings[0].scenarioValue).toBe(result.holdings[0].currentValue)
    expect(result.holdings[0].priceChangePct).toBe(0)
  })

  it("counts cash in both totals", () => {
    // 10 × 180 = 1800 in holdings, plus 5000 cash.
    expect(run().currentTotal).toBeCloseTo(6800, 4)
  })
})

describe("price scenarios", () => {
  it("applies a percentage move", () => {
    const result = run({
      priceAdjustments: [{ symbol: "NVDA", market: "US", changePct: 10 }],
    })
    expect(result.holdings[0].scenarioPrice).toBeCloseTo(198, 6)
    expect(result.holdings[0].scenarioValue).toBeCloseTo(1980, 4)
    expect(result.difference).toBeCloseTo(180, 4)
  })

  it("applies a fall as readily as a rise", () => {
    const result = run({
      priceAdjustments: [{ symbol: "NVDA", market: "US", changePct: -25 }],
    })
    expect(result.holdings[0].scenarioPrice).toBeCloseTo(135, 6)
    expect(result.difference).toBeCloseTo(-450, 4)
    expect(result.differencePct).toBeCloseTo((-450 / 6800) * 100, 4)
  })

  it("prefers an absolute scenario price over a percentage", () => {
    const result = run({
      priceAdjustments: [{ symbol: "NVDA", market: "US", changePct: 10, scenarioPrice: 200 }],
    })
    expect(result.holdings[0].scenarioPrice).toBe(200)
  })

  it("never produces a negative price", () => {
    const result = run({
      priceAdjustments: [{ symbol: "NVDA", market: "US", changePct: -150 }],
    })
    expect(result.holdings[0].scenarioPrice).toBe(0)
    expect(result.holdings[0].scenarioValue).toBe(0)
  })

  it("recomputes unrealised P&L against the unchanged cost basis", () => {
    const result = run({
      priceAdjustments: [{ symbol: "NVDA", market: "US", changePct: 10 }],
    })
    expect(result.holdings[0].scenarioUnrealizedPnl).toBeCloseTo(1980 - 1700, 4)
  })

  it("shocks every holding at once", () => {
    const holdings = [holding(), holding({ symbol: "AAPL", currentPrice: 200, marketValue: 2000, baseMarketValue: 2000 })]
    const result = simulateWhatIf({
      holdings,
      baseCurrency: "USD",
      cash: 0,
      cashDelta: 0,
      priceAdjustments: uniformPriceShock(holdings, -10),
      quantityAdjustments: [],
    })
    expect(result.holdings.every((h) => h.priceChangePct !== null && h.priceChangePct < -9.9)).toBe(true)
    expect(result.differencePct).toBeCloseTo(-10, 4)
  })
})

describe("cash and contributions", () => {
  it("adds cash to the portfolio total without touching a holding", () => {
    const result = run({ cashDelta: 20_000 })
    expect(result.scenarioCash).toBe(25_000)
    expect(result.difference).toBeCloseTo(20_000, 4)
    expect(result.holdings[0].scenarioValue).toBe(result.holdings[0].currentValue)
  })

  it("removes cash too", () => {
    expect(run({ cashDelta: -2000 }).scenarioCash).toBe(3000)
  })

  it("does not count a negative cash balance as an asset", () => {
    // The real portfolio treats a negative balance as an incomplete history, not a liability.
    const result = run({ cash: 1000, cashDelta: -5000 })
    expect(result.scenarioCash).toBe(-4000)
    expect(result.scenarioTotal).toBeCloseTo(1800, 4)
  })

  it("converts money into shares at the scenario price", () => {
    // 1,800 into NVDA at a scenario price of 200 buys 9 shares on top of the 10 held.
    const result = run({
      priceAdjustments: [{ symbol: "NVDA", market: "US", scenarioPrice: 200 }],
      quantityAdjustments: [{ symbol: "NVDA", market: "US", amountDelta: 1800 }],
    })
    expect(result.holdings[0].scenarioQuantity).toBeCloseTo(19, 6)
    expect(result.holdings[0].scenarioValue).toBeCloseTo(3800, 4)
  })

  it("adds shares directly", () => {
    const result = run({
      quantityAdjustments: [{ symbol: "NVDA", market: "US", quantityDelta: 5 }],
    })
    expect(result.holdings[0].scenarioQuantity).toBe(15)
    expect(result.holdings[0].scenarioValue).toBeCloseTo(2700, 4)
  })

  it("adds the new shares at the scenario price as their cost", () => {
    const result = run({
      quantityAdjustments: [{ symbol: "NVDA", market: "US", quantityDelta: 10 }],
    })
    // 1700 for the original ten, plus 10 × 180 for the new ones.
    expect(result.holdings[0].scenarioInvested).toBeCloseTo(1700 + 1800, 4)
  })
})

describe("reducing a position", () => {
  it("removes a percentage of it", () => {
    const result = run({
      quantityAdjustments: [{ symbol: "NVDA", market: "US", reducePct: 25 }],
    })
    expect(result.holdings[0].scenarioQuantity).toBeCloseTo(7.5, 6)
    expect(result.holdings[0].scenarioValue).toBeCloseTo(1350, 4)
  })

  it("releases a proportional share of the cost basis", () => {
    const result = run({
      quantityAdjustments: [{ symbol: "NVDA", market: "US", reducePct: 50 }],
    })
    expect(result.holdings[0].scenarioInvested).toBeCloseTo(850, 4)
  })

  it("closes the position at 100%", () => {
    const result = run({
      quantityAdjustments: [{ symbol: "NVDA", market: "US", reducePct: 100 }],
    })
    expect(result.holdings[0].scenarioQuantity).toBe(0)
    expect(result.holdings[0].scenarioValue).toBe(0)
    // The holding is still listed: a scenario table is a portfolio, not a diff.
    expect(result.holdings).toHaveLength(1)
  })

  it("never goes short — a negative position is a different instrument", () => {
    const result = run({
      quantityAdjustments: [{ symbol: "NVDA", market: "US", quantityDelta: -50 }],
    })
    expect(result.holdings[0].scenarioQuantity).toBe(0)
  })

  it("applies an addition before a reduction, so the two read in order", () => {
    const result = run({
      quantityAdjustments: [{ symbol: "NVDA", market: "US", quantityDelta: 10, reducePct: 50 }],
    })
    expect(result.holdings[0].scenarioQuantity).toBe(10)
  })
})

describe("allocation", () => {
  it("recomputes every weight against the scenario total", () => {
    const result = simulateWhatIf({
      holdings: [
        holding(),
        holding({ symbol: "AAPL", currentPrice: 200, marketValue: 2000, baseMarketValue: 2000 }),
      ],
      baseCurrency: "USD",
      cash: 0,
      cashDelta: 0,
      priceAdjustments: [{ symbol: "NVDA", market: "US", changePct: 100 }],
      quantityAdjustments: [],
    })
    // NVDA doubles to 3600 against AAPL's 2000: 64.3% and 35.7%.
    expect(result.holdings[0].scenarioWeightPct).toBeCloseTo((3600 / 5600) * 100, 3)
    expect(result.holdings[1].scenarioWeightPct).toBeCloseTo((2000 / 5600) * 100, 3)
    const total = result.holdings.reduce((sum, h) => sum + (h.scenarioWeightPct ?? 0), 0)
    expect(total).toBeCloseTo(100, 4)
  })
})

describe("multi-currency", () => {
  it("translates a foreign holding at its real rate by default", () => {
    const result = simulateWhatIf({
      holdings: [thaiHolding()],
      baseCurrency: "USD",
      cash: 0,
      cashDelta: 0,
      priceAdjustments: [],
      quantityAdjustments: [],
    })
    expect(result.holdings[0].scenarioBaseValue).toBeCloseTo(32_000 / 32.45, 4)
    expect(result.holdings[0].fxOverridden).toBe(false)
  })

  it("applies a scenario exchange rate when one is given", () => {
    const result = simulateWhatIf({
      holdings: [thaiHolding()],
      baseCurrency: "USD",
      cash: 0,
      cashDelta: 0,
      priceAdjustments: [],
      quantityAdjustments: [],
      // A weaker baht: 35 to the dollar instead of 32.45.
      fxOverrides: { THB: 1 / 35 },
    })
    expect(result.holdings[0].scenarioBaseValue).toBeCloseTo(32_000 / 35, 4)
    expect(result.holdings[0].fxOverridden).toBe(true)
    // The native value is untouched: the shares did not change, only what they translate to.
    expect(result.holdings[0].scenarioValue).toBeCloseTo(32_000, 4)
    expect(result.holdings[0].baseValueDelta).toBeLessThan(0)
  })

  it("leaves a holding with no rate untranslated rather than inventing one", () => {
    const result = simulateWhatIf({
      holdings: [thaiHolding({ fx: null, baseMarketValue: null, baseInvestedValue: null })],
      baseCurrency: "USD",
      cash: 1000,
      cashDelta: 0,
      priceAdjustments: [],
      quantityAdjustments: [],
    })
    expect(result.holdings[0].scenarioBaseValue).toBeNull()
    expect(result.holdings[0].scenarioWeightPct).toBeNull()
    expect(result.untranslatedCount).toBe(1)
    // Excluded from the total, and the count is what makes that honest.
    expect(result.scenarioTotal).toBe(1000)
  })

  it("can supply a rate for a holding that had none", () => {
    const result = simulateWhatIf({
      holdings: [thaiHolding({ fx: null, baseMarketValue: null })],
      baseCurrency: "USD",
      cash: 0,
      cashDelta: 0,
      priceAdjustments: [],
      quantityAdjustments: [],
      fxOverrides: { THB: 1 / 32 },
    })
    expect(result.holdings[0].scenarioBaseValue).toBeCloseTo(1000, 4)
    expect(result.untranslatedCount).toBe(0)
  })

  it("ignores a nonsensical override rather than producing a nonsensical value", () => {
    for (const rate of [0, -1, Number.NaN]) {
      const result = simulateWhatIf({
        holdings: [thaiHolding()],
        baseCurrency: "USD",
        cash: 0,
        cashDelta: 0,
        priceAdjustments: [],
        quantityAdjustments: [],
        fxOverrides: { THB: rate },
      })
      expect(result.holdings[0].scenarioBaseValue).toBeCloseTo(32_000 / 32.45, 4)
    }
  })

  it("needs no rate when the holding is already in the base currency", () => {
    const result = run({ fxOverrides: { THB: 1 / 40 } })
    expect(result.holdings[0].fxRate).toBe(1)
    expect(result.holdings[0].fxOverridden).toBe(false)
  })
})

describe("the same ticker on two venues stays two positions", () => {
  it("adjusts only the one named", () => {
    const result = simulateWhatIf({
      holdings: [holding({ symbol: "XYZ", market: "US" }), thaiHolding({ symbol: "XYZ" })],
      baseCurrency: "USD",
      cash: 0,
      cashDelta: 0,
      priceAdjustments: [{ symbol: "XYZ", market: "SET", changePct: 50 }],
      quantityAdjustments: [],
    })
    expect(result.holdings[0].priceChangePct).toBe(0)
    expect(result.holdings[1].priceChangePct).toBeCloseTo(50, 4)
  })
})
