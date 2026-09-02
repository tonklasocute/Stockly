import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildPortfolio, replayPortfolio } from "../holdings"
import { computeCash } from "../cash"
import { simulateWhatIf } from "./what-if"
import { planGoal, requiredContribution } from "./goal-plan"
import { simulateGrowth } from "./growth"
import { projectDividends } from "./dividend-plan"
import type { DomainTransaction } from "../types"

/**
 * The phase 11 invariant: **a simulation may never mutate the portfolio it was run against.**
 *
 * Three checks, each catching a different way it could break.
 *
 * The behavioural one runs a full portfolio through the engine, simulates everything at once, and
 * asserts that holdings, cost basis, realised and unrealised P&L and cash come back byte-identical.
 * The structural one reads the source of the simulation folder and fails if it ever imports a
 * database client, a writer or a mutation. The third checks the inputs themselves are not touched —
 * a JavaScript function can mutate its argument in place, and a `readonly` parameter type is a
 * compile-time promise, not a runtime one.
 */

const SIMULATION_DIR = join(process.cwd(), "domain", "simulation")

const tx = (
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  fee = 0,
  tradeDate = "2026-01-02",
  sequence = 0,
): DomainTransaction => ({ symbol, side, quantity, price, fee, tradeDate, sequence })

const TRANSACTIONS = [
  tx("NVDA", "buy", 10, 170, 1.5, "2026-01-02", 1),
  tx("AAPL", "buy", 20, 200, 1, "2026-02-02", 2),
  tx("NVDA", "sell", 4, 200, 1.5, "2026-03-02", 3),
]
const CASH = [{ kind: "deposit" as const, amount: 10_000, currency: "USD" as const, occurredOn: "2026-01-01" }]
const quote = (symbol: string) => ({ NVDA: { price: 180 }, AAPL: { price: 210 } })[symbol]

describe("a simulation cannot change the portfolio it ran against", () => {
  it("leaves holdings, cost basis and P&L byte-identical", () => {
    const before = buildPortfolio(TRANSACTIONS, quote)
    const cashBefore = computeCash(TRANSACTIONS, CASH, [])
    const tradesBefore = replayPortfolio(TRANSACTIONS).trades

    // Deep snapshots taken before anything runs, so a mutation cannot hide behind a shared reference.
    const holdingsSnapshot = structuredClone(before.holdings)
    const summarySnapshot = structuredClone(before.summary)
    const cashSnapshot = structuredClone(cashBefore)
    const transactionsSnapshot = structuredClone(TRANSACTIONS)

    // Every simulation the engine offers, against this portfolio, all at once.
    simulateWhatIf({
      holdings: before.holdings,
      baseCurrency: "USD",
      cash: cashBefore.balance,
      cashDelta: 50_000,
      priceAdjustments: [{ symbol: "NVDA", market: "US", changePct: -40 }],
      quantityAdjustments: [{ symbol: "AAPL", market: "US", reducePct: 100 }],
      fxOverrides: { THB: 1 / 40 },
    })
    simulateGrowth({
      initialValue: before.summary.marketValue,
      contribution: 10_000,
      frequency: "MONTHLY",
      timing: "END",
      annualReturn: 0.08,
      years: 10,
      contributionGrowth: 0.05,
      inflationRate: 0.03,
      currency: "USD",
    })
    planGoal({
      currentValue: before.summary.marketValue,
      targetValue: 5_000_000,
      contribution: 20_000,
      frequency: "MONTHLY",
      timing: "END",
      annualReturn: 0.08,
      years: 10,
      contributionGrowth: 0,
      inflationRate: null,
      currency: "USD",
    })
    requiredContribution({
      currentValue: before.summary.marketValue,
      targetValue: 5_000_000,
      annualReturn: 0.08,
      years: 10,
      frequency: "MONTHLY",
    })
    projectDividends({
      initialValue: before.summary.marketValue,
      contribution: 10_000,
      frequency: "MONTHLY",
      timing: "END",
      annualReturn: 0.08,
      years: 10,
      contributionGrowth: 0,
      annualYield: 0.04,
      yieldGrowth: 0.02,
      reinvest: true,
      costBasis: before.summary.investedValue,
      inflationRate: null,
      currency: "USD",
    })

    // The inputs themselves.
    expect(TRANSACTIONS).toEqual(transactionsSnapshot)
    expect(before.holdings).toEqual(holdingsSnapshot)
    expect(before.summary).toEqual(summarySnapshot)
    expect(cashBefore).toEqual(cashSnapshot)

    // And re-deriving from the transactions gives the same answer it did before any of that ran.
    const after = buildPortfolio(TRANSACTIONS, quote)
    expect(after.holdings).toEqual(holdingsSnapshot)
    expect(after.summary).toEqual(summarySnapshot)
    expect(computeCash(TRANSACTIONS, CASH, [])).toEqual(cashSnapshot)
    expect(replayPortfolio(TRANSACTIONS).trades).toEqual(tradesBefore)
  })

  it("returns new holding objects rather than the ones it was given", () => {
    const { holdings } = buildPortfolio(TRANSACTIONS, quote)
    const result = simulateWhatIf({
      holdings,
      baseCurrency: "USD",
      cash: 0,
      cashDelta: 0,
      priceAdjustments: [{ symbol: "NVDA", market: "US", changePct: 25 }],
      quantityAdjustments: [],
    })
    for (const scenario of result.holdings) {
      expect(holdings).not.toContain(scenario)
    }
  })

  it("is deterministic: the same inputs give the same numbers", () => {
    const scenario = {
      initialValue: 250_000,
      contribution: 10_000,
      frequency: "MONTHLY" as const,
      timing: "END" as const,
      annualReturn: 0.08,
      years: 15,
      contributionGrowth: 0.03,
      inflationRate: 0.025,
      currency: "THB" as const,
    }
    const from = new Date("2026-09-02T00:00:00Z")
    expect(simulateGrowth(scenario, { from })).toEqual(simulateGrowth(scenario, { from }))
  })
})

describe("the simulation engine cannot reach a database", () => {
  const files = readdirSync(SIMULATION_DIR).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  )

  it("has files to check, so the assertions below are not vacuous", () => {
    expect(files.length).toBeGreaterThan(3)
  })

  it.each(files)("%s imports no client, no writer and no framework", (file) => {
    const source = readFileSync(join(SIMULATION_DIR, file), "utf8")
    // A simulation is arithmetic. Any of these appearing here would mean it had grown a way to
    // write, fetch or persist — which is the failure this whole folder is designed to prevent.
    for (const forbidden of [
      "@/lib/supabase",
      "supabase",
      "server-only",
      "next/",
      "revalidatePath",
      "fetch(",
      "@/services/",
      "@/features/",
    ]) {
      expect(source.includes(forbidden), `${file} must not reference ${forbidden}`).toBe(false)
    }
  })

  it.each(files)("%s declares no mutating function", (file) => {
    const source = readFileSync(join(SIMULATION_DIR, file), "utf8")
    for (const forbidden of [/\binsert\s*\(/, /\bupdate\s*\(/, /\bdelete\s*\(/, /\bupsert\s*\(/]) {
      expect(forbidden.test(source), `${file} must not call ${forbidden}`).toBe(false)
    }
  })
})
