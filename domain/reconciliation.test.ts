import { describe, expect, it } from "vitest"
import {
  CASH_CAUSES,
  POSITION_CAUSES,
  reconcileCash,
  reconcilePositions,
  statusFor,
  summarise,
  type BrokerCashBalance,
  type BrokerPosition,
} from "./reconciliation"
import { computeCashByCurrency } from "./cash"
import { computePositions } from "./holdings"
import type { DomainTransaction, Position } from "./types"

const position = (over: Partial<Position> = {}): Position => ({
  symbol: "AAPL",
  market: "US",
  currency: "USD",
  quantity: 100,
  investedValue: 1000,
  averageCost: 10,
  realizedPnl: 0,
  ...over,
})

const broker = (over: Partial<BrokerPosition> = {}): BrokerPosition => ({
  symbol: "AAPL",
  market: "US",
  quantity: 100,
  averageCost: 10,
  currency: "USD",
  ...over,
})

describe("reconcilePositions", () => {
  it("matches identical positions", () => {
    const [diff] = reconcilePositions([broker()], [position()])
    expect(diff.status).toBe("MATCHED")
    expect(diff.quantityDifference).toBe(0)
    expect(diff.causes).toEqual([])
  })

  it("reports a quantity difference with the broker's side minus Stockly's", () => {
    const [diff] = reconcilePositions([broker({ quantity: 105 })], [position()])
    expect(diff.status).toBe("QUANTITY_DIFFERS")
    expect(diff.quantityDifference).toBe(5)
  })

  it("names a clean ratio as looking like an unrecorded split", () => {
    const [diff] = reconcilePositions([broker({ quantity: 200, averageCost: 5 })], [position()])
    expect(diff.status).toBe("QUANTITY_DIFFERS")
    expect(diff.causes).toContain("SPLIT_RATIO")
  })

  it("does not call an arbitrary difference a split", () => {
    const [diff] = reconcilePositions([broker({ quantity: 137 })], [position()])
    expect(diff.causes).not.toContain("SPLIT_RATIO")
  })

  it("reports a reverse-split ratio too", () => {
    const [diff] = reconcilePositions([broker({ quantity: 10, averageCost: 100 })], [position()])
    expect(diff.causes).toContain("SPLIT_RATIO")
  })

  it("reports a cost difference beyond the rounding tolerance", () => {
    const [diff] = reconcilePositions([broker({ averageCost: 12 })], [position()])
    expect(diff.status).toBe("COST_DIFFERS")
    expect(diff.costDifferencePct).toBeCloseTo(20, 6)
    expect(diff.causes).toContain("COST_METHOD")
  })

  it("absorbs a statement's rounding rather than reporting it", () => {
    const [diff] = reconcilePositions([broker({ averageCost: 10.02 })], [position()])
    expect(diff.status).toBe("MATCHED")
  })

  it("treats an unreported cost as unknown, never as zero", () => {
    const [diff] = reconcilePositions([broker({ averageCost: null })], [position()])
    expect(diff.status).toBe("MATCHED")
    expect(diff.brokerAverageCost).toBeNull()
    expect(diff.costDifferencePct).toBeNull()
    expect(diff.causes).toContain("COST_NOT_REPORTED")
  })

  it("reports a position only the broker has", () => {
    const [diff] = reconcilePositions([broker({ symbol: "NVDA" })], [])
    expect(diff.status).toBe("MISSING_IN_STOCKLY")
    expect(diff.stocklyQuantity).toBeNull()
    expect(diff.causes).toContain("MISSING_TRANSACTION")
  })

  it("reports a position only Stockly has", () => {
    const [diff] = reconcilePositions([], [position()])
    expect(diff.status).toBe("MISSING_IN_BROKER")
    expect(diff.brokerQuantity).toBeNull()
    expect(diff.causes).toContain("EXTRA_TRANSACTION")
  })

  it("does not report a closed position as missing from the statement", () => {
    expect(reconcilePositions([], [position({ quantity: 0, investedValue: 0, averageCost: 0 })])).toEqual([])
  })

  it("keeps two venues apart — the same letters are two instruments", () => {
    const diffs = reconcilePositions(
      [broker({ symbol: "PTT", market: "SET", currency: "THB" })],
      [position({ symbol: "PTT", market: "US" })],
    )
    expect(diffs).toHaveLength(2)
    expect(diffs.map((d) => d.status).sort()).toEqual(["MISSING_IN_BROKER", "MISSING_IN_STOCKLY"])
  })

  it("reports a currency mismatch rather than silently comparing across currencies", () => {
    const [diff] = reconcilePositions([broker({ currency: "THB" })], [position()])
    expect(diff.status).toBe("CURRENCY_MISMATCH")
    expect(diff.causes).toEqual(["CURRENCY"])
  })

  it("compares against the positions the engine derived, not against stored holdings", () => {
    const history: DomainTransaction[] = [
      { symbol: "AAPL", market: "US", side: "buy", tradeDate: "2026-01-05", quantity: 100, price: 10, fee: 0 },
      { symbol: "AAPL", market: "US", side: "sell", tradeDate: "2026-02-05", quantity: 40, price: 12, fee: 0 },
    ]
    const [diff] = reconcilePositions([broker({ quantity: 60 })], computePositions(history))
    expect(diff.status).toBe("MATCHED")
  })

  it("never says who is wrong", () => {
    const forbidden = /\b(wrong|incorrect|error|fix|should|must|buy|sell)\b/i
    for (const cause of Object.values(POSITION_CAUSES)) expect(cause).not.toMatch(forbidden)
  })
})

describe("reconcileCash", () => {
  const usd = (over: Partial<BrokerCashBalance> = {}): BrokerCashBalance => ({
    currency: "USD",
    balance: 500,
    ...over,
  })

  const ledger = (transactions: DomainTransaction[] = [], cash: Parameters<typeof computeCashByCurrency>[1] = []) =>
    computeCashByCurrency(transactions, cash)

  it("matches a balance the ledger agrees with", () => {
    const [diff] = reconcileCash(
      [usd()],
      ledger([], [{ kind: "deposit", amount: 500, currency: "USD", occurredOn: "2026-01-01" }]),
    )
    expect(diff.status).toBe("MATCHED")
    expect(diff.difference).toBe(0)
  })

  it("reports the difference in the currency itself, broker minus Stockly", () => {
    const [diff] = reconcileCash(
      [usd({ balance: 620 })],
      ledger([], [{ kind: "deposit", amount: 500, currency: "USD", occurredOn: "2026-01-01" }]),
    )
    expect(diff.status).toBe("DIFFERS")
    expect(diff.difference).toBe(120)
    expect(diff.causes).toContain("MISSING_MOVEMENT")
  })

  it("absorbs sub-cent rounding", () => {
    const [diff] = reconcileCash(
      [usd({ balance: 500.004 })],
      ledger([], [{ kind: "deposit", amount: 500, currency: "USD", occurredOn: "2026-01-01" }]),
    )
    expect(diff.status).toBe("MATCHED")
  })

  it("never adds a dollar balance to a baht one", () => {
    const diffs = reconcileCash(
      [usd({ balance: 500 }), { currency: "THB", balance: 1000 }],
      ledger(
        [],
        [
          { kind: "deposit", amount: 500, currency: "USD", occurredOn: "2026-01-01" },
          { kind: "deposit", amount: 1000, currency: "THB", occurredOn: "2026-01-01" },
        ],
      ),
    )
    expect(diffs).toHaveLength(2)
    expect(diffs.every((d) => d.status === "MATCHED")).toBe(true)
  })

  it("reports a currency the ledger has never seen as its own row, not as a difference", () => {
    const [diff] = reconcileCash([{ currency: "THB", balance: 1000 }], [])
    expect(diff.status).toBe("MISSING_IN_STOCKLY")
    expect(diff.stocklyBalance).toBeNull()
    expect(diff.difference).toBeNull()
  })

  it("reports a currency the statement omits", () => {
    const [diff] = reconcileCash(
      [],
      ledger([], [{ kind: "deposit", amount: 500, currency: "USD", occurredOn: "2026-01-01" }]),
    )
    expect(diff.status).toBe("MISSING_IN_BROKER")
    expect(diff.brokerBalance).toBeNull()
    expect(diff.difference).toBeNull()
  })

  it("points at unrecorded funding when trades were entered without a deposit", () => {
    const [diff] = reconcileCash(
      [usd({ balance: 0 })],
      ledger([
        { symbol: "AAPL", market: "US", side: "buy", tradeDate: "2026-01-05", quantity: 10, price: 10, fee: 0 },
      ]),
    )
    expect(diff.status).toBe("DIFFERS")
    expect(diff.causes).toContain("UNRECORDED_FUNDING")
  })

  it("never says who is wrong", () => {
    const forbidden = /\b(wrong|incorrect|error|fix|should|must|buy|sell)\b/i
    for (const cause of Object.values(CASH_CAUSES)) expect(cause).not.toMatch(forbidden)
  })
})

describe("summarise / statusFor", () => {
  it("counts each side and reports a clean run as COMPLETED", () => {
    const summary = summarise(reconcilePositions([broker()], [position()]), [])
    expect(summary.positions).toEqual({ total: 1, matched: 1, differences: 0 })
    expect(summary.transactions).toBeNull()
    expect(statusFor(summary)).toBe("COMPLETED")
  })

  it("does not call a run with unexplained differences a clean success", () => {
    const summary = summarise(reconcilePositions([broker({ quantity: 105 })], [position()]), [])
    expect(statusFor(summary)).toBe("COMPLETED_WITH_WARNINGS")
  })

  it("counts trade-level findings when a statement carried them", () => {
    const summary = summarise([], [], { total: 10, matched: 9, differences: 1 })
    expect(statusFor(summary)).toBe("COMPLETED_WITH_WARNINGS")
  })
})

describe("reconciliation is a comparison and nothing else", () => {
  it("does not mutate either side", () => {
    const positions = [position()]
    const brokerPositions = [broker({ quantity: 105 })]
    const snapshotPositions = structuredClone(positions)
    const snapshotBroker = structuredClone(brokerPositions)

    reconcilePositions(brokerPositions, positions)

    expect(positions).toEqual(snapshotPositions)
    expect(brokerPositions).toEqual(snapshotBroker)
  })

  it("is deterministic — the same inputs produce the same report twice", () => {
    const run = () => reconcilePositions([broker({ quantity: 105 }), broker({ symbol: "NVDA" })], [position()])
    expect(run()).toEqual(run())
  })
})
