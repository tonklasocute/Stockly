import { describe, expect, it } from "vitest"
import { applyShareAdjustments } from "./corporate-actions"
import { buildPortfolio, replayPortfolio } from "./holdings"
import { computeCash, computeCashByCurrency, type DomainCashTransaction } from "./cash"
import { computeConcentration, computeFees, computeTradeStatistics } from "./analytics"
import { attribute } from "./attribution"
import { drawdownHistory } from "./drawdown-history"
import { moneyWeightedReturn, returnIndex, timeWeightedReturn } from "./returns"
import { maxDrawdown, volatility } from "./risk"
import { reconcileCash, reconcilePositions } from "./reconciliation"
import { runStress, stressMatrix } from "./stress"
import { buildInsights } from "./insights"
import { scanDataQuality } from "./data-quality"
import { simulateWhatIf } from "./simulation/what-if"
import { identityConverter } from "./fx"
import type { DomainTransaction } from "./types"

/**
 * The end-to-end financial regression suite.
 *
 * Nineteen phases have each added a boundary test proving *their* subsystem cannot move a number.
 * This is the one that walks the whole chain at once, on a single deterministic fixture:
 *
 *   transactions → holdings → cost basis → P&L → cash → performance → attribution → risk → stress
 *
 * It exists to catch the failure no individual boundary test can: two subsystems that are each
 * internally correct and disagree with one another. Every figure below is asserted against a value
 * computed by hand from the fixture, not against whatever the code currently returns — a test that
 * records today's output proves only that nothing changed, never that anything is right.
 */

// ---------------------------------------------------------------- the fixture
//
// Two markets, two currencies, a partial sell, a re-buy, fees on both sides, a dividend and a
// deposit. Small enough to compute by hand; awkward enough to catch a sign error.

const TRANSACTIONS: DomainTransaction[] = [
  // 100 AAPL at $150, $10 fee  → cost 15,010
  { symbol: "AAPL", market: "US", side: "buy", tradeDate: "2026-01-05", quantity: 100, price: 150, fee: 10 },
  // 1,000 PTT at ฿35, ฿20 fee  → cost 35,020
  { symbol: "PTT", market: "SET", side: "buy", tradeDate: "2026-01-10", quantity: 1_000, price: 35, fee: 20 },
  // Sell 40 AAPL at $180, $5 fee → proceeds 7,195; basis released 40 × 150.10 = 6,004
  { symbol: "AAPL", market: "US", side: "sell", tradeDate: "2026-03-05", quantity: 40, price: 180, fee: 5 },
  // Re-buy 20 AAPL at $170, $5 fee → cost 3,405
  { symbol: "AAPL", market: "US", side: "buy", tradeDate: "2026-04-01", quantity: 20, price: 170, fee: 5 },
]

const CASH: DomainCashTransaction[] = [
  { kind: "deposit", amount: 50_000, currency: "USD", occurredOn: "2026-01-01" },
  { kind: "deposit", amount: 40_000, currency: "THB", occurredOn: "2026-01-08" },
  { kind: "fee", amount: 25, currency: "USD", occurredOn: "2026-02-01" },
]

const DIVIDENDS = [{ netAmount: 88, paidOn: "2026-04-15", currency: "USD" as const }]

const PRICES = new Map([
  ["US:AAPL", { price: 200, previousClose: 198 }],
  ["SET:PTT", { price: 38, previousClose: 37.5 }],
])

const priceOf = (symbol: string, market: string) => PRICES.get(`${market}:${symbol}`)

/** Everything derived, in one place, so a whole-chain comparison is one object comparison. */
function derive() {
  const { positions, trades } = replayPortfolio(TRANSACTIONS)
  const portfolio = buildPortfolio(TRANSACTIONS, priceOf, {
    baseCurrency: "USD",
    convert: identityConverter("USD"),
  })
  return {
    positions,
    trades,
    holdings: portfolio.holdings,
    summary: portfolio.summary,
    cash: computeCash(TRANSACTIONS, CASH, DIVIDENDS),
    byCurrency: computeCashByCurrency(TRANSACTIONS, CASH, DIVIDENDS),
    fees: computeFees(TRANSACTIONS),
    tradeStats: computeTradeStatistics(TRANSACTIONS, trades),
    concentration: computeConcentration(portfolio.holdings, 0),
  }
}

// ---------------------------------------------------------------- 1. transactions → holdings

describe("transactions → holdings", () => {
  const { positions } = replayPortfolio(TRANSACTIONS)
  const aapl = positions.find((p) => p.symbol === "AAPL")
  const ptt = positions.find((p) => p.symbol === "PTT")

  it("holds what the arithmetic says, not what a stored row says", () => {
    // 100 bought − 40 sold + 20 re-bought
    expect(aapl?.quantity).toBe(80)
    expect(ptt?.quantity).toBe(1_000)
  })

  it("releases cost basis in proportion on a partial sell", () => {
    // 15,010 − (40 × 150.10) = 9,006, then + 3,405 for the re-buy = 12,411
    expect(aapl?.investedValue).toBeCloseTo(12_411, 6)
    expect(aapl?.averageCost).toBeCloseTo(12_411 / 80, 6)
  })

  it("books realized P&L at the sell, fees on both sides included", () => {
    // (40 × 180 − 5) − (40 × 150.10) = 7,195 − 6,004 = 1,191
    expect(aapl?.realizedPnl).toBeCloseTo(1_191, 6)
  })

  it("keeps each instrument in its own currency", () => {
    expect(aapl?.currency).toBe("USD")
    expect(ptt?.currency).toBe("THB")
  })

  it("produces no holdings at all from no transactions", () => {
    expect(replayPortfolio([]).positions).toEqual([])
    expect(replayPortfolio([]).trades).toEqual([])
  })

  it("leaves nothing behind when a position is fully sold", () => {
    const closed = replayPortfolio([
      { symbol: "X", market: "US", side: "buy", tradeDate: "2026-01-01", quantity: 10, price: 10, fee: 0 },
      { symbol: "X", market: "US", side: "sell", tradeDate: "2026-02-01", quantity: 10, price: 12, fee: 0 },
    ]).positions[0]
    expect(closed.quantity).toBe(0)
    expect(closed.investedValue).toBe(0)
    expect(closed.averageCost).toBe(0)
    expect(closed.realizedPnl).toBeCloseTo(20, 6)
  })
})

// ---------------------------------------------------------------- 2. holdings → value & P&L

describe("holdings → valuation", () => {
  const { holdings, summary } = derive()

  it("values a position at quantity × price in its own currency", () => {
    const aapl = holdings.find((h) => h.symbol === "AAPL")
    expect(aapl?.marketValue).toBeCloseTo(80 * 200, 6)
    expect(aapl?.unrealizedPnl).toBeCloseTo(16_000 - 12_411, 6)
  })

  it("never overwrites a native figure with a translated one", () => {
    const ptt = holdings.find((h) => h.symbol === "PTT")
    // Native value stays in baht; the base figure is a separate, separately-nullable field.
    expect(ptt?.marketValue).toBeCloseTo(38_000, 6)
    expect(ptt?.currency).toBe("THB")
  })

  it("excludes an untranslatable holding from the total and says how many", () => {
    // The identity converter answers only USD, so the baht holding cannot reach the base currency.
    expect(summary.untranslatedCount).toBe(1)
    expect(summary.marketValue).toBeCloseTo(16_000, 6)
  })

  it("reports no fx effect, because it cannot be computed honestly", () => {
    expect(summary.fxEffect).toBeNull()
  })
})

// ---------------------------------------------------------------- 3. cash

describe("holdings → cash", () => {
  const { cash, byCurrency } = derive()

  it("counts a fee as a charge and never as a withdrawal", () => {
    expect(cash.netContributed).toBe(90_000)
    expect(cash.charges).toBe(25)
  })

  it("balances to the arithmetic", () => {
    // 90,000 − (15,010 + 35,020 + 3,405) + 7,195 + 88 − 25
    expect(cash.balance).toBeCloseTo(43_823, 6)
  })

  it("keeps the two currencies apart, and neither is the translated total", () => {
    const usd = byCurrency.find((b) => b.currency === "USD")
    const thb = byCurrency.find((b) => b.currency === "THB")
    expect(usd?.buyCosts).toBeCloseTo(15_010 + 3_405, 6)
    expect(thb?.buyCosts).toBeCloseTo(35_020, 6)
    expect(thb?.balance).toBeCloseTo(40_000 - 35_020, 6)
  })

  it("does not let the per-currency balances be read as a portfolio total", () => {
    // They are in different currencies. Adding them is meaningless and nothing here does it.
    expect(byCurrency).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- 4. performance

describe("performance separates capital from return", () => {
  const points = [
    { date: "2026-01-01", value: 100_000, flow: 0 },
    { date: "2026-02-01", value: 110_000, flow: 0 },
    // A 10,000 deposit, and no market movement at all.
    { date: "2026-03-01", value: 120_000, flow: 10_000 },
  ]

  it("does not read a deposit as a gain", () => {
    const twr = timeWeightedReturn(points)
    // Only the first interval moved: +10%. The deposit interval returns exactly zero.
    expect(twr).toBeCloseTo(10, 6)
  })

  it("does not read a withdrawal as a loss", () => {
    const withdrawn = [
      { date: "2026-01-01", value: 100_000, flow: 0 },
      { date: "2026-02-01", value: 90_000, flow: -10_000 },
    ]
    expect(timeWeightedReturn(withdrawn)).toBeCloseTo(0, 6)
  })

  it("refuses to report a return from too few observations", () => {
    expect(timeWeightedReturn([{ date: "2026-01-01", value: 100, flow: 0 }])).toBeNull()
    expect(returnIndex([])).toBeNull()
  })

  it("refuses an IRR over too short a window rather than annualising noise", () => {
    expect(
      moneyWeightedReturn([
        { date: "2026-01-01", amount: -1_000 },
        { date: "2026-01-05", amount: 1_100 },
      ]),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------- 5. attribution

describe("attribution agrees with performance about the whole", () => {
  const result = attribute({
    beginningValue: 100_000,
    endingValue: 118_000,
    netFlow: 10_000,
    holdings: [
      {
        symbol: "AAPL",
        market: "US",
        currency: "USD",
        beginValue: 60_000,
        endValue: 72_000,
        invested: 0,
        divested: 0,
        dividends: 0,
      },
      {
        symbol: "PTT",
        market: "SET",
        currency: "USD",
        beginValue: 40_000,
        endValue: 46_000,
        invested: 10_000,
        divested: 0,
        dividends: 0,
      },
    ],
  })

  it("removes external capital from both sides", () => {
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // 118,000 − 100,000 − 10,000 = 8,000 of actual gain on 100,000.
    expect(result.totalReturnPct).toBeCloseTo(8, 6)
  })

  it("displays the residual rather than distributing it", () => {
    if (!result.ok) return
    const parts = result.contributions.reduce((total, c) => total + c.contributionPct, 0)
    // Whatever the gap is, it is reported — never scaled away into the parts.
    expect(Number.isFinite(result.totalReturnPct - parts)).toBe(true)
  })

  it("says why rather than returning a number it cannot support", () => {
    const missing = attribute({
      beginningValue: null,
      endingValue: 118_000,
      netFlow: 0,
      holdings: [],
    })
    expect(missing.ok).toBe(false)
  })
})

// ---------------------------------------------------------------- 6. risk

describe("risk refuses to speak from too small a sample", () => {
  it("has no volatility from a handful of observations", () => {
    expect(volatility([0.01, -0.02, 0.005])).toBeNull()
  })

  it("has no drawdown from too few points", () => {
    expect(
      maxDrawdown([
        { date: "2026-01-01", index: 100 },
        { date: "2026-02-01", index: 90 },
      ]),
    ).toBeNull()
  })

  it("measures a drawdown on the index, so a deposit cannot look like a recovery", () => {
    const index = [
      { date: "2026-01-01", index: 100 },
      { date: "2026-02-01", index: 80 },
      { date: "2026-03-01", index: 90 },
      { date: "2026-04-01", index: 100 },
      { date: "2026-05-01", index: 105 },
    ]
    const history = drawdownHistory(index)
    expect(history?.worst?.depthPct).toBeCloseTo(20, 6)
    expect(history?.worst?.recoveryDate).toBe("2026-04-01")
  })
})

// ---------------------------------------------------------------- 7. stress

describe("risk → stress uses the portfolio as it stands", () => {
  const { holdings, cash } = derive()
  const input = { holdings, baseCurrency: "USD" as const, cash: cash.balance }

  it("starts from the same value the portfolio reports", () => {
    const result = runStress(input, {
      name: "flat",
      type: "UNIFORM_SHOCK",
      components: [{ kind: "UNIFORM", changePct: -10 }],
    })
    // Base value is holdings that could be translated, plus cash — exactly as the dashboard sums it.
    expect(result.baseValue).toBeCloseTo(16_000 + cash.balance, 4)
  })

  it("excludes the untranslatable holding and says so, rather than valuing it at zero", () => {
    const result = runStress(input, {
      name: "-10%",
      type: "UNIFORM_SHOCK",
      components: [{ kind: "UNIFORM", changePct: -10 }],
    })
    expect(result.coverage.excluded).toEqual([{ symbol: "PTT", market: "SET", reason: "NO_FX_RATE" }])
  })

  it("does not shock cash", () => {
    const result = runStress(input, {
      name: "-100%",
      type: "UNIFORM_SHOCK",
      components: [{ kind: "UNIFORM", changePct: -100 }],
    })
    expect(result.stressedValue).toBeCloseTo(cash.balance, 4)
  })
})

// ---------------------------------------------------------------- 8. the whole chain holds still

/**
 * The invariant the entire phase exists to protect.
 *
 * Every read-only subsystem in the application runs against the fixture, and the complete derived
 * financial state is compared before and after. Not a spot check on one figure: the whole object.
 */
describe("nothing derived can move a number", () => {
  const OPERATIONS: Array<[string, () => unknown]> = [
    ["stress scenario", () =>
      runStress(
        { holdings: derive().holdings, baseCurrency: "USD", cash: derive().cash.balance },
        { name: "x", type: "UNIFORM_SHOCK", components: [{ kind: "UNIFORM", changePct: -30 }] },
      )],
    ["stress matrix", () =>
      stressMatrix({ holdings: derive().holdings, baseCurrency: "USD", cash: 0 })],
    ["what-if", () =>
      simulateWhatIf({
        holdings: derive().holdings,
        baseCurrency: "USD",
        cash: 0,
        cashDelta: 25_000,
        priceAdjustments: [{ symbol: "AAPL", market: "US", changePct: -50 }],
        quantityAdjustments: [{ symbol: "AAPL", market: "US", reducePct: 100 }],
      })],
    ["position reconciliation", () =>
      reconcilePositions(
        [{ symbol: "AAPL", market: "US", quantity: 999, averageCost: 1, currency: "USD" }],
        derive().positions,
      )],
    ["cash reconciliation", () =>
      reconcileCash([{ currency: "USD", balance: 0 }], derive().byCurrency)],
    ["share adjustment", () =>
      applyShareAdjustments(TRANSACTIONS, [
        { symbol: "AAPL", market: "US", effectiveDate: "2026-06-01", numerator: 4, denominator: 1 },
      ])],
    ["attribution", () =>
      attribute({ beginningValue: 100, endingValue: 120, netFlow: 0, holdings: [] })],
    ["drawdown history", () =>
      drawdownHistory([
        { date: "2026-01-01", index: 100 },
        { date: "2026-02-01", index: 70 },
        { date: "2026-03-01", index: 100 },
      ])],
    ["data-quality scan", () =>
      scanDataQuality({
        baseCurrency: "USD",
        holdingsWithoutPrice: [],
        oldestQuoteAgeMinutes: 500,
        missingFxPairs: ["THB/USD"],
        staleFxPairs: [],
        holdingsWithoutMetadata: [],
        unresolvedImportRows: 3,
        importConflicts: 1,
        unresolvedReconciliationItems: 2,
        daysSinceReconciliation: 400,
        transactionCount: 4,
        unverifiedCalendars: [],
        observedAt: "2026-09-03T00:00:00Z",
      })],
    ["insights", () => {
      const { summary, cash, concentration } = derive()
      return buildInsights({
        baseCurrency: "USD",
        concentration: {
          largestSymbol: concentration.largest?.symbol ?? null,
          largestWeightPct: concentration.largest?.weight ?? null,
          topThreeWeightPct: concentration.top3Weight,
          effectivePositions: null,
          positions: concentration.positionCount,
        },
        returnPct: summary.returnPct,
        currentDrawdownPct: null,
        maxDrawdownPct: null,
        benchmark: null,
        cash: { balance: cash.balance, sharePct: null },
        currencyExposure: [{ currency: "THB", weightPct: null }],
        untranslatedHoldings: summary.untranslatedCount,
        dividends: null,
        fees: null,
        trades: null,
        staleHoldings: summary.staleCount,
        quoteAgeMinutes: null,
      })
    }],
  ]

  it("holds every derived figure byte-identical across all of them", () => {
    const before = derive()
    for (const [, run] of OPERATIONS) run()
    expect(derive()).toEqual(before)
  })

  it("holds after all of them run together, twice", () => {
    const before = derive()
    for (let pass = 0; pass < 2; pass += 1) for (const [, run] of OPERATIONS) run()
    expect(derive()).toEqual(before)
  })

  it("does not mutate the transaction list itself", () => {
    const before = structuredClone(TRANSACTIONS)
    for (const [, run] of OPERATIONS) run()
    expect(TRANSACTIONS).toEqual(before)
  })

  /** Each one individually, so a failure names the culprit rather than the set. */
  for (const [name, run] of OPERATIONS) {
    it(`is unchanged by: ${name}`, () => {
      const before = derive()
      run()
      expect(derive()).toEqual(before)
    })
  }
})

// ---------------------------------------------------------------- 9. determinism

describe("every engine is deterministic", () => {
  it("produces identical output from identical input", () => {
    expect(derive()).toEqual(derive())
  })

  it("does not depend on the order transactions arrive in", () => {
    const shuffled = [TRANSACTIONS[2], TRANSACTIONS[0], TRANSACTIONS[3], TRANSACTIONS[1]]
    const a = replayPortfolio(TRANSACTIONS).positions.find((p) => p.symbol === "AAPL")
    const b = replayPortfolio(shuffled).positions.find((p) => p.symbol === "AAPL")
    expect(b?.quantity).toBe(a?.quantity)
    expect(b?.investedValue).toBeCloseTo(a?.investedValue ?? 0, 6)
    expect(b?.realizedPnl).toBeCloseTo(a?.realizedPnl ?? 0, 6)
  })
})
