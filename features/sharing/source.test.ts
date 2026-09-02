import { describe, expect, it } from "vitest"
import { toShareSource } from "./source"
import type { IntelligenceBundle } from "@/features/intelligence/loader"

/**
 * The other half of the privacy boundary.
 *
 * `domain/sharing-leak.test.ts` proves the projector emits only what it is handed. This proves the
 * handing itself is narrow: a full intelligence bundle goes in — journals, theses, goal notes,
 * transaction rows and every internal id the loader carries — and a `ShareSource` comes out with
 * none of it.
 *
 * The bundle is a hand-built minimum rather than a real one. Constructing a genuine bundle needs a
 * database and a price provider, and what is under test here is selection, not calculation.
 */

const PRIVATE = {
  journalNote: "Bought because the datacentre story is intact",
  thesisNote: "Sell if margins compress two quarters running",
  goalNote: "Retire at 55 and move to Chiang Mai",
  brokerRef: "SCB-8891-0022",
  userId: "11111111-1111-4111-8111-111111111111",
  email: "someone@example.com",
}

function bundle(): IntelligenceBundle {
  const holding = {
    symbol: "NVDA",
    market: "US",
    currency: "USD",
    quantity: 10,
    investedValue: 1_700,
    averageCost: 170,
    realizedPnl: 0,
    currentPrice: 180,
    marketValue: 1_800,
    baseMarketValue: 1_800,
    unrealizedPnl: 100,
    returnPct: 5.88,
    weight: 100,
    todayPnl: null,
    todayReturnPct: null,
    stale: false,
  }

  return {
    baseCurrency: "USD",
    range: "1Y",
    valuations: [],
    timeWeightedReturnPct: 5.1,
    moneyWeightedReturnPct: 5.4,
    risk: {
      volatility: null,
      sharpe: null,
      drawdown: null,
      beta: null,
      concentration: null,
      observations: 3,
      limitations: ["Not enough history."],
    },
    benchmark: null,
    // Rows straight from the database, notes and ids included — exactly what the loader holds.
    goals: [
      {
        row: {
          id: "goal-1",
          portfolio_id: "p-1",
          user_id: PRIVATE.userId,
          type: "PORTFOLIO_VALUE",
          target_value: 200_000,
          currency: "USD",
          target_date: "2035-01-01",
          note: PRIVATE.goalNote,
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        progress: {
          type: "PORTFOLIO_VALUE",
          current: 1_800,
          target: 200_000,
          progressPct: 0.9,
          remaining: 198_200,
          achieved: false,
          unit: "money",
          currency: "USD",
          targetDate: "2035-01-01",
          daysRemaining: 3_000,
          unavailableReason: null,
        },
      },
    ],
    theses: [
      {
        id: "thesis-1",
        portfolio_id: "p-1",
        user_id: PRIVATE.userId,
        symbol: "NVDA",
        status: "ACTIVE",
        summary: PRIVATE.thesisNote,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    insights: [
      { code: "CONCENTRATION_HIGH", type: "ALLOCATION", severity: "NOTICE", title: "One position", detail: "NVDA is 100%.", metric: null },
    ],
    analytics: {
      holdings: [holding],
      summary: {
        currency: "USD",
        marketValue: 1_800,
        investedValue: 1_700,
        unrealizedPnl: 100,
        realizedPnl: 0,
        returnPct: 5.88,
        holdingsCount: 1,
        todayPnl: null,
        todayReturnPct: null,
        staleCount: 0,
        untranslatedCount: 0,
        fxStaleCount: 0,
        exposures: [],
        fxEffect: null,
      },
      baseCurrency: "USD",
      staleMarkets: [],
      missingFxPairs: [],
      totalValue: 1_800,
      allocation: [{ key: "NVDA", label: "NVDA", value: 1_800, weight: 100 }],
      currencies: [{ key: "USD", label: "USD", value: 1_800, weight: 100 }],
      cash: { balance: 0 },
      dividends: {
        summary: { trailingTwelveMonths: 0 },
        yieldOnValue: null,
        yieldOnCost: null,
      },
      quoteAsOf: "2026-09-02T10:00:00.000Z",
      marketDataError: null,
      // Present in the real bundle and deliberately included here: the source builder must not
      // reach into them.
      trades: [{ symbol: "NVDA", proceeds: 900, costBasis: 850, realizedPnl: 50 }],
      transactionCount: 4,
    },
  } as unknown as IntelligenceBundle
}

describe("building the share source", () => {
  const serialised = () => JSON.stringify(toShareSource(bundle(), "Growth"))

  it("carries no journal, thesis or goal note", () => {
    const json = serialised()
    expect(json.includes(PRIVATE.journalNote)).toBe(false)
    expect(json.includes(PRIVATE.thesisNote)).toBe(false)
    expect(json.includes(PRIVATE.goalNote)).toBe(false)
  })

  it("carries no user id, email or broker reference", () => {
    const json = serialised()
    expect(json.includes(PRIVATE.userId)).toBe(false)
    expect(json.includes(PRIVATE.email)).toBe(false)
    expect(json.includes(PRIVATE.brokerRef)).toBe(false)
  })

  it("labels a goal by its type, never by its note", () => {
    const [goal] = toShareSource(bundle(), "Growth").goals
    expect(goal.label).toBe("Portfolio value")
    expect(goal.progressPct).toBe(0.9)
  })

  it("takes the calculation time from the quote, not from the clock", () => {
    // A page that printed "calculated now" over a forty-minute-old quote would be exactly the
    // dishonesty the freshness fields exist to prevent.
    expect(toShareSource(bundle(), "Growth").calculatedAt).toBe("2026-09-02T10:00:00.000Z")
  })

  it("reads figures from the bundle rather than recomputing any of them", () => {
    const share = toShareSource(bundle(), "Growth")
    expect(share.overview.totalValue).toBe(1_800)
    expect(share.overview.returnPct).toBe(5.88)
    expect(share.performance.timeWeightedReturnPct).toBe(5.1)
  })

  it("keeps a risk statistic null when the engine could not compute it", () => {
    const share = toShareSource(bundle(), "Growth")
    expect(share.risk.volatilityPct).toBeNull()
    expect(share.risk.sharpe).toBeNull()
    expect(share.risk.limitations).toEqual(["Not enough history."])
  })

  it("falls back to the portfolio's own name and nothing else", () => {
    expect(toShareSource(bundle(), "Growth").portfolioName).toBe("Growth")
  })
})
