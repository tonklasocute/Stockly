import { describe, expect, it } from "vitest"
import {
  applyShareAdjustments,
  isAdjustable,
  isReverseSplit,
  parseRatio,
  previewShareAdjustment,
  ratioOf,
  UNADJUSTABLE_REASON,
  type ShareAdjustment,
} from "./corporate-actions"
import { replayPortfolio, computePositions } from "./holdings"
import type { DomainTransaction } from "./types"

const buy = (over: Partial<DomainTransaction> = {}): DomainTransaction => ({
  symbol: "AAPL",
  market: "US",
  side: "buy",
  tradeDate: "2026-01-05",
  quantity: 100,
  price: 10,
  fee: 1,
  ...over,
})

const split = (over: Partial<ShareAdjustment> = {}): ShareAdjustment => ({
  symbol: "AAPL",
  market: "US",
  effectiveDate: "2026-06-01",
  numerator: 2,
  denominator: 1,
  ...over,
})

describe("parseRatio", () => {
  it("reads the shapes an exchange publishes", () => {
    expect(parseRatio("2:1")).toEqual({ numerator: 2, denominator: 1 })
    expect(parseRatio(" 4 : 1 ")).toEqual({ numerator: 4, denominator: 1 })
    expect(parseRatio("1/10")).toEqual({ numerator: 1, denominator: 10 })
    expect(parseRatio("3-2")).toEqual({ numerator: 3, denominator: 2 })
    expect(parseRatio("1.5:1")).toEqual({ numerator: 1.5, denominator: 1 })
  })

  it("refuses anything it cannot read rather than guessing", () => {
    for (const input of [null, undefined, "", "two for one", "2", "2:", ":1", "abc:def"]) {
      expect(parseRatio(input)).toBeNull()
    }
  })

  it("refuses a zero on either side — a ratio of zero would erase a position", () => {
    expect(parseRatio("0:1")).toBeNull()
    expect(parseRatio("1:0")).toBeNull()
  })
})

describe("ratioOf / isReverseSplit", () => {
  it("reads a split and a reverse split off the same arithmetic", () => {
    expect(ratioOf({ numerator: 2, denominator: 1 })).toBe(2)
    expect(isReverseSplit({ numerator: 2, denominator: 1 })).toBe(false)
    expect(isReverseSplit({ numerator: 1, denominator: 10 })).toBe(true)
  })
})

describe("applyShareAdjustments", () => {
  it("returns the transactions untouched when there is nothing to apply", () => {
    const txs = [buy()]
    expect(applyShareAdjustments(txs, [])).toEqual(txs)
  })

  it("multiplies the share count and divides the price", () => {
    const [adjusted] = applyShareAdjustments([buy()], [split()])
    expect(adjusted.quantity).toBe(200)
    expect(adjusted.price).toBe(5)
  })

  it("never touches the fee — a commission was paid in cash, once", () => {
    const [adjusted] = applyShareAdjustments([buy({ fee: 7.5 })], [split()])
    expect(adjusted.fee).toBe(7.5)
  })

  it("preserves the cost basis, which is the whole point", () => {
    const before = computePositions([buy()])[0]
    const after = computePositions(applyShareAdjustments([buy()], [split()]))[0]
    expect(after.investedValue).toBeCloseTo(before.investedValue, 6)
    expect(after.quantity).toBe(before.quantity * 2)
    expect(after.averageCost).toBeCloseTo(before.averageCost / 2, 6)
  })

  it("leaves a trade on the effective date alone — it is already priced post-split", () => {
    const onTheDay = buy({ tradeDate: "2026-06-01" })
    expect(applyShareAdjustments([onTheDay], [split()])).toEqual([onTheDay])
  })

  it("leaves a trade after the effective date alone", () => {
    const after = buy({ tradeDate: "2026-07-01" })
    expect(applyShareAdjustments([after], [split()])).toEqual([after])
  })

  it("adjusts only the instrument the split belongs to", () => {
    const other = buy({ symbol: "MSFT" })
    const [aapl, msft] = applyShareAdjustments([buy(), other], [split()])
    expect(aapl.quantity).toBe(200)
    expect(msft).toEqual(other)
  })

  it("does not cross markets — SET:PTT and US:PTT are different instruments", () => {
    const thai = buy({ symbol: "PTT", market: "SET" })
    const american = buy({ symbol: "PTT", market: "US" })
    const [adjustedThai, adjustedUs] = applyShareAdjustments(
      [thai, american],
      [split({ symbol: "PTT", market: "SET" })],
    )
    expect(adjustedThai.quantity).toBe(200)
    expect(adjustedUs).toEqual(american)
  })

  it("compounds two splits, oldest first", () => {
    const [adjusted] = applyShareAdjustments(
      [buy()],
      [
        split({ effectiveDate: "2026-09-01", numerator: 3, denominator: 1 }),
        split({ effectiveDate: "2026-06-01", numerator: 2, denominator: 1 }),
      ],
    )
    expect(adjusted.quantity).toBe(600)
    expect(adjusted.price).toBeCloseTo(10 / 6, 6)
  })

  it("halves the share count on a reverse split and doubles the price", () => {
    const [adjusted] = applyShareAdjustments([buy()], [split({ numerator: 1, denominator: 2 })])
    expect(adjusted.quantity).toBe(50)
    expect(adjusted.price).toBe(20)
  })

  it("keeps a fractional share rather than discarding it", () => {
    const [adjusted] = applyShareAdjustments(
      [buy({ quantity: 25 })],
      [split({ numerator: 1, denominator: 2 })],
    )
    expect(adjusted.quantity).toBe(12.5)
  })

  /**
   * The invariant that makes a split safe: it moves no money. A sell that happened before the
   * split booked a profit, and adjusting the history must not change what was booked.
   */
  it("leaves realized P&L on a pre-split sell unchanged", () => {
    const history: DomainTransaction[] = [
      buy(),
      { ...buy(), side: "sell", tradeDate: "2026-03-01", quantity: 40, price: 15 },
    ]
    const before = replayPortfolio(history)
    const after = replayPortfolio(applyShareAdjustments(history, [split()]))

    expect(after.trades[0].realizedPnl).toBeCloseTo(before.trades[0].realizedPnl, 4)
    expect(after.trades[0].proceeds).toBeCloseTo(before.trades[0].proceeds, 4)
    expect(after.positions[0].realizedPnl).toBeCloseTo(before.positions[0].realizedPnl, 4)
  })

  it("is reversible: removing the adjustment restores every figure", () => {
    const history = [buy(), buy({ tradeDate: "2026-02-01", quantity: 30, price: 12 })]
    const before = computePositions(history)
    const after = computePositions(applyShareAdjustments(history, []))
    expect(after).toEqual(before)
  })

  /**
   * A ratio like 3:1 has no exact fixed-decimal price, so cost is preserved to the scale of the
   * money type rather than exactly. The bound is pinned here so it cannot widen unnoticed.
   */
  it("keeps the residue from an inexact ratio below a millionth per share", () => {
    const history = [buy({ quantity: 3, price: 10, fee: 0 })]
    const before = computePositions(history)[0]
    const after = computePositions(
      applyShareAdjustments(history, [split({ numerator: 3, denominator: 1 })]),
    )[0]
    expect(Math.abs(after.investedValue - before.investedValue)).toBeLessThan(
      after.quantity * 1e-6,
    )
  })
})

describe("previewShareAdjustment", () => {
  const position = { symbol: "AAPL", market: "US" as const, quantity: 100, averageCost: 10, investedValue: 1000 }

  it("shows the before and after, and that the invested value does not move", () => {
    const preview = previewShareAdjustment(position, { numerator: 2, denominator: 1 })
    expect(preview.quantityBefore).toBe(100)
    expect(preview.quantityAfter).toBe(200)
    expect(preview.averageCostBefore).toBe(10)
    expect(preview.averageCostAfter).toBe(5)
    expect(preview.investedValue).toBe(1000)
  })

  it("reports no fraction when the ratio divides evenly", () => {
    expect(previewShareAdjustment(position, { numerator: 2, denominator: 1 }).fractionalShares).toBe(0)
  })

  it("reports the leftover fraction instead of rounding it away", () => {
    const preview = previewShareAdjustment(
      { ...position, quantity: 25 },
      { numerator: 1, denominator: 2 },
    )
    expect(preview.quantityAfter).toBe(12.5)
    expect(preview.fractionalShares).toBe(0.5)
  })

  it("has no average cost for a position with no shares left", () => {
    const preview = previewShareAdjustment(
      { ...position, quantity: 0, averageCost: 0, investedValue: 0 },
      { numerator: 2, denominator: 1 },
    )
    expect(preview.quantityAfter).toBe(0)
    expect(preview.averageCostAfter).toBe(0)
  })
})

describe("what Stockly refuses to apply", () => {
  it("adjusts splits and nothing else", () => {
    expect(isAdjustable("SPLIT")).toBe(true)
    expect(isAdjustable("REVERSE_SPLIT")).toBe(true)
    for (const type of ["MERGER", "ACQUISITION", "RIGHTS_OFFERING", "TENDER_OFFER", "DIVIDEND", "EARNINGS"]) {
      expect(isAdjustable(type)).toBe(false)
    }
  })

  it("says why, for every event that changes a portfolio but cannot be derived", () => {
    for (const type of ["MERGER", "ACQUISITION", "RIGHTS_OFFERING", "TENDER_OFFER"]) {
      expect(UNADJUSTABLE_REASON[type]).toBeTruthy()
    }
  })

  it("never tells the user what to do about one", () => {
    const forbidden = /\b(buy|sell|hold|should|recommend|advise|target)\b/i
    for (const reason of Object.values(UNADJUSTABLE_REASON)) {
      expect(reason).not.toMatch(forbidden)
    }
  })
})
