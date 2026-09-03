import { describe, expect, it } from "vitest"
import EN_ENUMS from "@/locales/en/enums.json"
import TH_ENUMS from "@/locales/th/enums.json"
import {
  CASH_FLOW_DIRECTION,
  CASH_FLOW_KINDS,
  computeCash,
  computeCashByCurrency,
  isCapitalFlow,
  signedAmount,
  type CashFlowKind,
  type DomainCashTransaction,
} from "./cash"
import type { Currency } from "./market"
import type { DomainTransaction } from "./types"

const buy = (q: number, p: number, fee = 0): DomainTransaction => ({
  symbol: "NVDA", side: "buy", tradeDate: "2026-01-02", quantity: q, price: p, fee,
})
const sell = (q: number, p: number, fee = 0): DomainTransaction => ({
  symbol: "NVDA", side: "sell", tradeDate: "2026-02-02", quantity: q, price: p, fee,
})
const deposit = (amount: number, currency: Currency = "USD") => ({
  kind: "deposit" as const, amount, currency, occurredOn: "2026-01-01",
})
const withdrawal = (amount: number, currency: Currency = "USD") => ({
  kind: "withdrawal" as const, amount, currency, occurredOn: "2026-03-01",
})

describe("cash balance", () => {
  it("is zero for an empty portfolio", () => {
    expect(computeCash([], []).balance).toBe(0)
  })

  it("counts a deposit", () => {
    expect(computeCash([], [deposit(10000)]).balance).toBe(10000)
  })

  it("subtracts a withdrawal", () => {
    expect(computeCash([], [deposit(10000), withdrawal(2500)]).balance).toBe(7500)
  })

  it("subtracts the buy cost including its fee", () => {
    const cash = computeCash([buy(10, 170, 1.5)], [deposit(10000)])
    expect(cash.buyCosts).toBe(1701.5)
    expect(cash.balance).toBe(8298.5)
  })

  it("adds sell proceeds net of the sell fee", () => {
    const cash = computeCash([buy(10, 170, 1.5), sell(10, 190, 1)], [deposit(10000)])
    expect(cash.sellProceeds).toBe(1899)
    expect(cash.balance).toBe(10197.5) // 10000 - 1701.5 + 1899
  })

  it("adds net dividends", () => {
    const cash = computeCash([], [deposit(1000)], [{ netAmount: 42.5, paidOn: "2026-02-15" }])
    expect(cash.balance).toBe(1042.5)
    expect(cash.dividends).toBe(42.5)
  })

  it("never double-counts fees", () => {
    // The fee is inside buyCosts already; the balance must drop by exactly cost + fee, once.
    const cash = computeCash([buy(1, 100, 9.99)], [deposit(1000)])
    expect(cash.balance).toBe(890.01)
  })

  it("goes negative when trades were recorded without the deposit that funded them", () => {
    // Honest, not clamped: the user is missing rows, and hiding that would hide the mistake.
    expect(computeCash([buy(10, 170)], []).balance).toBe(-1700)
  })

  it("reports net contributed separately from the balance", () => {
    const cash = computeCash([buy(10, 170)], [deposit(10000), withdrawal(1000)])
    expect(cash.netContributed).toBe(9000)
    expect(cash.balance).toBe(7300)
  })

  it("stays exact across many small amounts", () => {
    const deposits = Array.from({ length: 300 }, () => deposit(0.01))
    expect(computeCash([], deposits).balance).toBe(3)
  })
})

// ---------------------------------------------------------------- phase 19: the wider ledger

describe("cash flow kinds", () => {
  it("gives every kind a direction, and a name in both languages", () => {
    // The words moved to the `enums` namespace in phase 21; the rule that every kind has one is
    // now checked against both files rather than against one English map.
    for (const kind of CASH_FLOW_KINDS) {
      expect(CASH_FLOW_DIRECTION[kind]).toBeDefined()
      expect(EN_ENUMS.cashFlow[kind], `en ${kind}`).toBeTruthy()
      expect(TH_ENUMS.cashFlow[kind], `th ${kind}`).toBeTruthy()
    }
  })

  /**
   * The distinction the whole return layer rests on. A deposit is not a profit, and a custody fee
   * is not a withdrawal — classifying either one wrongly makes performance a fiction.
   */
  it("separates capital crossing the boundary from what happened to the portfolio", () => {
    for (const kind of ["deposit", "withdrawal", "transfer_in", "transfer_out", "adjustment_in", "adjustment_out"] as const) {
      expect(isCapitalFlow(kind)).toBe(true)
    }
    for (const kind of ["fee", "tax", "interest"] as const) {
      expect(isCapitalFlow(kind)).toBe(false)
    }
  })

  it("signs an amount by its kind, never by a sign stored on the row", () => {
    expect(signedAmount({ kind: "deposit", amount: 100 })).toBe(100)
    expect(signedAmount({ kind: "fee", amount: 100 })).toBe(-100)
    expect(signedAmount({ kind: "interest", amount: 100 })).toBe(100)
    expect(signedAmount({ kind: "transfer_out", amount: 100 })).toBe(-100)
  })
})

describe("computeCash with the wider ledger", () => {
  const flow = (kind: CashFlowKind, amount: number): DomainCashTransaction => ({
    kind,
    amount,
    currency: "USD",
    occurredOn: "2026-01-01",
  })

  it("counts a transfer in as contributed capital, exactly like a deposit", () => {
    const viaDeposit = computeCash([], [flow("deposit", 1000)])
    const viaTransfer = computeCash([], [flow("transfer_in", 1000)])
    expect(viaTransfer.netContributed).toBe(viaDeposit.netContributed)
    expect(viaTransfer.balance).toBe(viaDeposit.balance)
  })

  it("does not count a fee as a withdrawal — the portfolio did worse, it was not drawn down", () => {
    const summary = computeCash([], [flow("deposit", 1000), flow("fee", 25)])
    expect(summary.netContributed).toBe(1000)
    expect(summary.charges).toBe(25)
    expect(summary.balance).toBe(975)
  })

  it("counts tax as a charge and interest as income, neither as capital", () => {
    const summary = computeCash([], [flow("tax", 10), flow("interest", 4)])
    expect(summary.netContributed).toBe(0)
    expect(summary.charges).toBe(10)
    expect(summary.interest).toBe(4)
    expect(summary.balance).toBe(-6)
  })

  it("treats an adjustment as a correction to capital, not as a return", () => {
    const summary = computeCash([], [flow("adjustment_in", 50)])
    expect(summary.netContributed).toBe(50)
    expect(summary.interest).toBe(0)
  })
})

describe("computeCashByCurrency", () => {
  it("keeps each currency's balance to itself", () => {
    const balances = computeCashByCurrency(
      [],
      [
        { kind: "deposit", amount: 1000, currency: "USD", occurredOn: "2026-01-01" },
        { kind: "deposit", amount: 32000, currency: "THB", occurredOn: "2026-01-01" },
        { kind: "fee", amount: 20, currency: "USD", occurredOn: "2026-02-01" },
      ],
    )
    expect(balances.map((b) => b.currency)).toEqual(["THB", "USD"])
    expect(balances.find((b) => b.currency === "USD")?.balance).toBe(980)
    expect(balances.find((b) => b.currency === "THB")?.balance).toBe(32000)
  })

  it("derives a trade's currency from its market and never from a stored field", () => {
    const balances = computeCashByCurrency(
      [
        { symbol: "AAPL", market: "US", side: "buy", tradeDate: "2026-01-05", quantity: 10, price: 10, fee: 0 },
        { symbol: "PTT", market: "SET", side: "buy", tradeDate: "2026-01-05", quantity: 100, price: 35, fee: 0 },
      ],
      [],
    )
    expect(balances.find((b) => b.currency === "USD")?.buyCosts).toBe(100)
    expect(balances.find((b) => b.currency === "THB")?.buyCosts).toBe(3500)
  })

  it("puts a dividend in the currency it was paid in", () => {
    const balances = computeCashByCurrency([], [], [{ netAmount: 500, paidOn: "2026-03-01", currency: "THB" }])
    expect(balances).toHaveLength(1)
    expect(balances[0]).toMatchObject({ currency: "THB", dividends: 500 })
  })

  it("never produces a total across currencies", () => {
    const balances = computeCashByCurrency(
      [],
      [
        { kind: "deposit", amount: 1, currency: "USD", occurredOn: "2026-01-01" },
        { kind: "deposit", amount: 1, currency: "THB", occurredOn: "2026-01-01" },
      ],
    )
    // Two rows, each complete on its own. There is deliberately no combined figure to read.
    expect(balances).toHaveLength(2)
    expect(balances.every((b) => b.balance === 1)).toBe(true)
  })

  it("agrees with computeCash when everything is in one currency", () => {
    const transactions = [
      { symbol: "AAPL", market: "US" as const, side: "buy" as const, tradeDate: "2026-01-05", quantity: 10, price: 10, fee: 1 },
    ]
    const flows: DomainCashTransaction[] = [
      { kind: "deposit", amount: 1000, currency: "USD", occurredOn: "2026-01-01" },
    ]
    const [byCurrency] = computeCashByCurrency(transactions, flows)
    const total = computeCash(transactions, flows)
    expect(byCurrency.balance).toBe(total.balance)
    expect(byCurrency.netContributed).toBe(total.netContributed)
  })
})
