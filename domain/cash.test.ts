import { describe, expect, it } from "vitest"
import { computeCash } from "./cash"
import type { DomainTransaction } from "./types"

const buy = (q: number, p: number, fee = 0): DomainTransaction => ({
  symbol: "NVDA", side: "buy", tradeDate: "2026-01-02", quantity: q, price: p, fee,
})
const sell = (q: number, p: number, fee = 0): DomainTransaction => ({
  symbol: "NVDA", side: "sell", tradeDate: "2026-02-02", quantity: q, price: p, fee,
})
const deposit = (amount: number) => ({ kind: "deposit" as const, amount, occurredOn: "2026-01-01" })
const withdrawal = (amount: number) => ({ kind: "withdrawal" as const, amount, occurredOn: "2026-03-01" })

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
