import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { applyShareAdjustments, previewShareAdjustment } from "./corporate-actions"
import { computeCash, computeCashByCurrency, type DomainCashTransaction } from "./cash"
import { buildPortfolio, replayPortfolio } from "./holdings"
import { reconcileCash, reconcilePositions, statusFor, summarise } from "./reconciliation"
import type { DomainTransaction } from "./types"

/**
 * The cross-phase invariants for portfolio operations.
 *
 * Phase 19 adds the first machinery in Stockly whose *purpose* is to look at a portfolio and
 * describe what is wrong with it. That is one short step from machinery that fixes it, and the step
 * is the one this file exists to prevent:
 *
 *   External data → reconciliation → difference → **human review** → explicit adjustment → engine
 *
 * Everything to the left of "human review" is a pure function of two readings. These tests run the
 * whole comparison layer against a portfolio and assert that every figure is byte-identical
 * afterwards — the same shape as `news-invariants` and `fundamentals-invariants`, for the same
 * reason: a guarantee nobody checks is a guarantee that lapses.
 */

const TRANSACTIONS: DomainTransaction[] = [
  { symbol: "AAPL", market: "US", side: "buy", tradeDate: "2026-01-05", quantity: 100, price: 150, fee: 1 },
  { symbol: "AAPL", market: "US", side: "sell", tradeDate: "2026-03-05", quantity: 40, price: 180, fee: 1 },
  { symbol: "PTT", market: "SET", side: "buy", tradeDate: "2026-02-01", quantity: 500, price: 35, fee: 20 },
]

const CASH: DomainCashTransaction[] = [
  { kind: "deposit", amount: 30_000, currency: "USD", occurredOn: "2026-01-01" },
  { kind: "deposit", amount: 20_000, currency: "THB", occurredOn: "2026-01-20" },
  { kind: "fee", amount: 12, currency: "USD", occurredOn: "2026-02-15" },
]

const DIVIDENDS = [{ netAmount: 88, paidOn: "2026-04-01", currency: "USD" as const }]

const PRICES = new Map([
  ["US:AAPL", { price: 190, previousClose: 188 }],
  ["SET:PTT", { price: 38, previousClose: 37.5 }],
])

const snapshot = () => {
  const { positions, trades } = replayPortfolio(TRANSACTIONS)
  const portfolio = buildPortfolio(TRANSACTIONS, (symbol, market) => PRICES.get(`${market}:${symbol}`))
  return {
    positions,
    trades,
    holdings: portfolio.holdings,
    summary: portfolio.summary,
    cash: computeCash(TRANSACTIONS, CASH, DIVIDENDS),
    byCurrency: computeCashByCurrency(TRANSACTIONS, CASH, DIVIDENDS),
  }
}

/** Every comparison phase 19 can run, against a portfolio, all at once. */
function reconcileEverything() {
  const { positions } = replayPortfolio(TRANSACTIONS)
  const byCurrency = computeCashByCurrency(TRANSACTIONS, CASH, DIVIDENDS)

  const positionDifferences = reconcilePositions(
    [
      // A quantity that differs, a cost that differs, a position Stockly has never heard of.
      { symbol: "AAPL", market: "US", quantity: 120, averageCost: 151, currency: "USD" },
      { symbol: "PTT", market: "SET", quantity: 500, averageCost: 99, currency: "THB" },
      { symbol: "NVDA", market: "US", quantity: 10, averageCost: null, currency: "USD" },
    ],
    positions,
  )
  const cashDifferences = reconcileCash(
    [
      { currency: "USD", balance: 1 },
      { currency: "EUR", balance: 500 },
    ],
    byCurrency,
  )
  return { positionDifferences, cashDifferences }
}

describe("reconciliation cannot move a number", () => {
  it("leaves every figure byte-identical", () => {
    const before = snapshot()
    reconcileEverything()
    expect(snapshot()).toEqual(before)
  })

  it("finds real differences — so the test above is not passing vacuously", () => {
    const { positionDifferences, cashDifferences } = reconcileEverything()
    expect(positionDifferences.some((d) => d.status !== "MATCHED")).toBe(true)
    expect(cashDifferences.some((d) => d.status !== "MATCHED")).toBe(true)
  })

  it("produces the same report twice", () => {
    expect(reconcileEverything()).toEqual(reconcileEverything())
  })

  it("does not mutate the portfolio it was handed", () => {
    const positions = replayPortfolio(TRANSACTIONS).positions
    const copy = structuredClone(positions)
    reconcilePositions([{ symbol: "AAPL", market: "US", quantity: 1, averageCost: 1, currency: "USD" }], positions)
    expect(positions).toEqual(copy)
  })

  it("reports a run with differences as a run with differences, not as a success", () => {
    const { positionDifferences, cashDifferences } = reconcileEverything()
    expect(statusFor(summarise(positionDifferences, cashDifferences))).toBe("COMPLETED_WITH_WARNINGS")
  })
})

describe("a preview cannot move a number", () => {
  it("leaves every figure byte-identical after previewing a split on every position", () => {
    const before = snapshot()
    for (const position of before.positions) {
      previewShareAdjustment(position, { numerator: 2, denominator: 1 })
      previewShareAdjustment(position, { numerator: 1, denominator: 10 })
    }
    expect(snapshot()).toEqual(before)
  })
})

describe("an adjustment moves shares and never money", () => {
  const SPLIT = [{ symbol: "AAPL", market: "US" as const, effectiveDate: "2026-06-01", numerator: 2, denominator: 1 }]

  it("does nothing at all when there is no adjustment recorded", () => {
    // The state every portfolio is in until a user confirms a split, and the one this whole
    // mechanism has to be invisible in.
    expect(applyShareAdjustments(TRANSACTIONS, [])).toEqual(TRANSACTIONS)
    expect(replayPortfolio(applyShareAdjustments(TRANSACTIONS, []))).toEqual(replayPortfolio(TRANSACTIONS))
  })

  it("leaves realized P&L where it was", () => {
    const before = replayPortfolio(TRANSACTIONS)
    const after = replayPortfolio(applyShareAdjustments(TRANSACTIONS, SPLIT))
    for (const [index, trade] of after.trades.entries()) {
      expect(trade.realizedPnl).toBeCloseTo(before.trades[index].realizedPnl, 4)
    }
  })

  it("leaves the cash balance untouched — a split settles no cash", () => {
    const adjusted = applyShareAdjustments(TRANSACTIONS, SPLIT)
    expect(computeCash(adjusted, CASH, DIVIDENDS).balance).toBeCloseTo(
      computeCash(TRANSACTIONS, CASH, DIVIDENDS).balance,
      4,
    )
  })

  it("touches only the instrument it names", () => {
    const after = replayPortfolio(applyShareAdjustments(TRANSACTIONS, SPLIT)).positions
    const before = replayPortfolio(TRANSACTIONS).positions
    const ptt = (positions: typeof before) => positions.find((p) => p.symbol === "PTT")
    expect(ptt(after)).toEqual(ptt(before))
  })

  it("is fully reversible", () => {
    const before = snapshot()
    applyShareAdjustments(TRANSACTIONS, SPLIT)
    expect(snapshot()).toEqual(before)
  })
})

describe("currencies are never silently combined", () => {
  it("keeps a dollar balance and a baht balance apart", () => {
    const balances = computeCashByCurrency(TRANSACTIONS, CASH, DIVIDENDS)
    const usd = balances.find((b) => b.currency === "USD")
    const thb = balances.find((b) => b.currency === "THB")
    expect(usd).toBeDefined()
    expect(thb).toBeDefined()
    // The Thai balance reflects only the Thai trade and the Thai deposit.
    expect(thb?.buyCosts).toBeCloseTo(500 * 35 + 20, 6)
    expect(usd?.buyCosts).toBeCloseTo(100 * 150 + 1, 6)
  })

  it("never converts one currency into another to make a comparison work", () => {
    const differences = reconcileCash(
      [{ currency: "USD", balance: 100 }],
      computeCashByCurrency([], [{ kind: "deposit", amount: 3200, currency: "THB", occurredOn: "2026-01-01" }]),
    )
    // A dollar statement against a baht ledger is two separate facts, never one difference.
    expect(differences).toHaveLength(2)
    expect(differences.every((d) => d.difference === null)).toBe(true)
  })
})

describe("missing data stays missing", () => {
  it("reports an unstated broker cost as null rather than zero", () => {
    const [difference] = reconcilePositions(
      [{ symbol: "AAPL", market: "US", quantity: 60, averageCost: null, currency: "USD" }],
      replayPortfolio(TRANSACTIONS).positions,
    )
    expect(difference.brokerAverageCost).toBeNull()
    expect(difference.costDifferencePct).toBeNull()
  })

  it("reports an absent side as null rather than an empty position", () => {
    const [difference] = reconcilePositions([], replayPortfolio(TRANSACTIONS).positions)
    expect(difference.brokerQuantity).toBeNull()
    expect(difference.quantityDifference).toBeNull()
  })
})

describe("the comparison layer has no way to write", () => {
  const SOURCES = ["reconciliation.ts", "corporate-actions.ts"].map((file) => ({
    file,
    text: readFileSync(join(process.cwd(), "domain", file), "utf8"),
  }))

  /**
   * The structural half of the guarantee. A module with no client, no fetch and no framework import
   * cannot change anything no matter what a future edit does to its arithmetic.
   */
  it("imports nothing that could reach a database or a network", () => {
    for (const { file, text } of SOURCES) {
      for (const forbidden of ["supabase", "server-only", "fetch(", "next/", "react"]) {
        expect(text.includes(forbidden), `${file} imports ${forbidden}`).toBe(false)
      }
    }
  })

  it("contains no verb that changes anything", () => {
    for (const { file, text } of SOURCES) {
      for (const forbidden of [".insert(", ".update(", ".delete(", ".upsert("]) {
        expect(text.includes(forbidden), `${file} contains ${forbidden}`).toBe(false)
      }
    }
  })

  /** Describing a difference is allowed. Telling somebody what to do about it is not. */
  it("never recommends an action", () => {
    const forbidden = /\b(you should|we recommend|must sell|must buy|advise)\b/i
    for (const { file, text } of SOURCES) {
      expect(text, file).not.toMatch(forbidden)
    }
  })
})
