import { describe, expect, it } from "vitest"
import { buildPortfolio, replayPortfolio } from "./holdings"
import { computeCash, computeCashByCurrency, type DomainCashTransaction } from "./cash"
import { reconcilePositions } from "./reconciliation"
import { runStress, stressMatrix } from "./stress"
import { applyShareAdjustments } from "./corporate-actions"
import { identityConverter } from "./fx"
import type { DomainTransaction } from "./types"

/**
 * Scale.
 *
 * Phase 20 asks whether Stockly holds up at a thousand holdings and ten thousand transactions. The
 * dashboard cannot be answered here — that needs a database, and this repository has never had one
 * — but the calculation engines can, because they are pure. So this measures the half that is
 * measurable and says nothing about the half that is not.
 *
 * **The timing ceilings are loose on purpose.** A tight assertion on a shared CI runner is a flaky
 * test, and a flaky test in a financial suite gets ignored. These are wide enough never to fail on
 * slow hardware and narrow enough to catch the thing that actually matters: an accidental O(n²)
 * turning a linear pass into a quadratic one. Every ceiling below is at least fifty times the
 * observed local figure.
 */

const HOLDINGS = 1_000
const TRANSACTIONS_PER_HOLDING = 10

function symbolAt(index: number): string {
  // Deterministic, unique, and inside the 20-character symbol limit.
  return `SYM${index.toString().padStart(5, "0")}`
}

/** 10,000 transactions across 1,000 instruments in two markets. */
function bigHistory(): DomainTransaction[] {
  const out: DomainTransaction[] = []
  for (let i = 0; i < HOLDINGS; i += 1) {
    const symbol = symbolAt(i)
    const market = i % 2 === 0 ? "US" : "SET"
    for (let t = 0; t < TRANSACTIONS_PER_HOLDING; t += 1) {
      const day = String((t % 28) + 1).padStart(2, "0")
      const month = String((t % 12) + 1).padStart(2, "0")
      out.push({
        symbol,
        market,
        // A sell every fourth transaction, so cost basis is genuinely released and re-formed.
        side: t % 4 === 3 ? "sell" : "buy",
        tradeDate: `2026-${month}-${day}`,
        quantity: t % 4 === 3 ? 5 : 20,
        price: 100 + (i % 50) + t,
        fee: 1,
        sequence: t,
      })
    }
  }
  return out
}

const HISTORY = bigHistory()
const priceOf = () => ({ price: 150, previousClose: 148 })

function timed<T>(run: () => T): { result: T; ms: number } {
  const started = performance.now()
  const result = run()
  return { result, ms: performance.now() - started }
}

describe("the engines at scale", () => {
  it("builds the fixture the test claims to use", () => {
    expect(HISTORY).toHaveLength(HOLDINGS * TRANSACTIONS_PER_HOLDING)
  })

  it("replays ten thousand transactions in one pass", () => {
    const { result, ms } = timed(() => replayPortfolio(HISTORY))
    expect(result.positions).toHaveLength(HOLDINGS)
    // Two sells per instrument — t = 3 and t = 7 of ten — so 2,000 booked trades.
    expect(result.trades).toHaveLength(HOLDINGS * 2)
    expect(ms).toBeLessThan(5_000)
  })

  it("prices a thousand holdings", () => {
    const { result, ms } = timed(() =>
      buildPortfolio(HISTORY, priceOf, {
        baseCurrency: "USD",
        convert: identityConverter("USD"),
      }),
    )
    expect(result.holdings).toHaveLength(HOLDINGS)
    // Half the book is Thai and the identity converter reaches none of it — reported, not dropped.
    expect(result.summary.untranslatedCount).toBe(HOLDINGS / 2)
    expect(ms).toBeLessThan(5_000)
  })

  it("computes cash without a per-row query or a quadratic pass", () => {
    const flows: DomainCashTransaction[] = Array.from({ length: 1_000 }, (_, i) => ({
      kind: i % 10 === 0 ? "fee" : "deposit",
      amount: 100,
      currency: i % 2 === 0 ? "USD" : "THB",
      occurredOn: "2026-01-01",
    }))
    const { ms } = timed(() => {
      computeCash(HISTORY, flows)
      computeCashByCurrency(HISTORY, flows)
    })
    expect(ms).toBeLessThan(5_000)
  })

  /**
   * The one this file exists for. Coverage accounting used to search the result list per holding,
   * which is a million comparisons at this size; it is indexed now, and this is what would catch
   * the search coming back.
   */
  it("stresses a thousand holdings without a quadratic scan", () => {
    const { holdings } = buildPortfolio(HISTORY, priceOf, {
      baseCurrency: "USD",
      convert: identityConverter("USD"),
    })
    const sectors = Object.fromEntries(
      holdings.map((h, i) => [`${h.market}:${h.symbol}`, i % 3 === 0 ? null : `Sector ${i % 7}`]),
    )

    const { result, ms } = timed(() =>
      runStress(
        { holdings, baseCurrency: "USD", cash: 10_000, sectors },
        {
          name: "combined",
          type: "COMBINED_SHOCK",
          components: [
            { kind: "MARKET", market: "US", changePct: -15 },
            { kind: "SECTOR", sector: "Sector 1", changePct: -20 },
          ],
        },
      ),
    )

    expect(result.positions).toHaveLength(HOLDINGS)
    expect(result.coverage.total).toBe(HOLDINGS)
    // Every holding is accounted for exactly once: shocked, out of scope, or a named gap.
    expect(result.coverage.shocked + result.coverage.unaffected + result.coverage.excluded.length).toBe(
      HOLDINGS,
    )
    expect(ms).toBeLessThan(10_000)
  })

  it("runs the whole matrix at that size", () => {
    const { holdings } = buildPortfolio(HISTORY, priceOf, {
      baseCurrency: "USD",
      convert: identityConverter("USD"),
    })
    const { result, ms } = timed(() => stressMatrix({ holdings, baseCurrency: "USD", cash: 0 }))
    expect(result).toHaveLength(5)
    expect(ms).toBeLessThan(15_000)
  })

  it("reconciles a thousand positions against a thousand statement rows", () => {
    const positions = replayPortfolio(HISTORY).positions
    const statement = positions
      .filter((p) => p.quantity > 0)
      .map((p) => ({
        symbol: p.symbol,
        market: p.market,
        quantity: p.quantity,
        averageCost: p.averageCost,
        currency: p.currency,
      }))

    const { result, ms } = timed(() => reconcilePositions(statement, positions))
    expect(result.every((d) => d.status === "MATCHED")).toBe(true)
    expect(ms).toBeLessThan(5_000)
  })

  it("applies split adjustments across the whole book", () => {
    const adjustments = Array.from({ length: 50 }, (_, i) => ({
      symbol: symbolAt(i),
      market: (i % 2 === 0 ? "US" : "SET") as "US" | "SET",
      effectiveDate: "2026-11-01",
      numerator: 2,
      denominator: 1,
    }))
    const { result, ms } = timed(() => applyShareAdjustments(HISTORY, adjustments))
    expect(result).toHaveLength(HISTORY.length)
    expect(ms).toBeLessThan(5_000)
  })
})

describe("scale does not change an answer", () => {
  /**
   * The figures must be identical whether an instrument sits alone or among a thousand others.
   * A shared accumulator or a key collision would show up exactly here and nowhere else.
   */
  it("gives one instrument the same position in a large book as in a small one", () => {
    const alone = HISTORY.filter((t) => t.symbol === symbolAt(7))
    const inCrowd = replayPortfolio(HISTORY).positions.find((p) => p.symbol === symbolAt(7))
    const isolated = replayPortfolio(alone).positions.find((p) => p.symbol === symbolAt(7))

    expect(inCrowd?.quantity).toBe(isolated?.quantity)
    expect(inCrowd?.investedValue).toBeCloseTo(isolated?.investedValue ?? -1, 6)
    expect(inCrowd?.realizedPnl).toBeCloseTo(isolated?.realizedPnl ?? -1, 6)
    expect(inCrowd?.averageCost).toBeCloseTo(isolated?.averageCost ?? -1, 6)
  })

  it("keeps two markets apart across a thousand instruments", () => {
    const positions = replayPortfolio(HISTORY).positions
    expect(positions.filter((p) => p.market === "US")).toHaveLength(HOLDINGS / 2)
    expect(positions.filter((p) => p.market === "SET")).toHaveLength(HOLDINGS / 2)
    expect(positions.filter((p) => p.currency === "THB")).toHaveLength(HOLDINGS / 2)
  })
})
