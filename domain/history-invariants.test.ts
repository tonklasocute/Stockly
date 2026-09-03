import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildPortfolio, replayPortfolio } from "./holdings"
import { computeCash } from "./cash"
import { attribute, rankContributors, residual } from "./attribution"
import { drawdownHistory, regimeOf } from "./drawdown-history"
import {
  capitalFlowsBetween,
  computeFeeImpact,
  computeTurnover,
  monthsBetween,
  netFlow,
  periodStart,
  previousPeriod,
  qualityOf,
  reconstructAt,
  type ReconstructionInput,
} from "./history"
import type { DomainTransaction } from "./types"

/**
 * The phase 16 invariants.
 *
 * **Historical analysis is a read.** Reconstructing March, attributing a return, measuring a
 * drawdown and building a monthly table are all questions asked of the transaction set — none of
 * them is an answer stored beside it. Running every one of them must leave the present portfolio
 * byte-identical, which is what this file asserts.
 *
 * The second half is structural: the three new engines are read for anything that could reach a
 * database, a network or a framework, the same way the simulation, import and sharing engines are.
 */

const tx = (
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  fee: number,
  tradeDate: string,
  sequence: number,
): DomainTransaction => ({ symbol, side, quantity, price, fee, tradeDate, sequence })

const TRANSACTIONS = [
  tx("NVDA", "buy", 10, 100, 1, "2026-01-10", 1),
  tx("AAPL", "buy", 20, 50, 1, "2026-02-10", 2),
  tx("NVDA", "sell", 4, 150, 1, "2026-03-10", 3),
  tx("AAPL", "buy", 10, 60, 1, "2026-04-10", 4),
]
const CASH = [
  { kind: "deposit" as const, amount: 5_000, currency: "USD" as const, occurredOn: "2026-01-01" },
  { kind: "withdrawal" as const, amount: 500, currency: "USD" as const, occurredOn: "2026-04-01" },
]
const DIVIDENDS = [{ date: "2026-02-20", amount: 30 }]
const INPUT: ReconstructionInput = {
  transactions: TRANSACTIONS,
  cashTransactions: CASH,
  dividends: DIVIDENDS,
  baseCurrency: "USD",
}
const quote = (symbol: string) => ({ NVDA: { price: 180 }, AAPL: { price: 70 } })[symbol]

function financialState(): string {
  const { holdings, summary } = buildPortfolio(TRANSACTIONS, quote)
  const { trades, positions } = replayPortfolio(TRANSACTIONS)
  const cash = computeCash(
    TRANSACTIONS,
    CASH,
    DIVIDENDS.map((d) => ({ netAmount: d.amount, paidOn: d.date })),
  )
  return JSON.stringify({ holdings, summary, trades, positions, cash })
}

const INDEX = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-0${Math.floor(i / 20) + 1}-${String((i % 20) + 1).padStart(2, "0")}`,
  index: 100 + Math.sin(i / 3) * 12 + i * 0.4,
}))

/** Every historical operation the application performs, once each. */
function everyHistoricalOperation(): void {
  for (const date of ["2026-01-31", "2026-02-28", "2026-03-31", "2026-06-30"]) {
    reconstructAt(INPUT, date)
  }
  capitalFlowsBetween(CASH, "2025-12-31", "2026-12-31")
  netFlow(capitalFlowsBetween(CASH, "2025-12-31", "2026-12-31"))
  computeTurnover(TRANSACTIONS, "2025-12-31", "2026-12-31", 2_000)
  computeFeeImpact(TRANSACTIONS, 2_000)
  monthsBetween("2026-01-01", "2026-09-01")
  periodStart("1Y", new Date("2026-09-03T00:00:00Z"))
  previousPeriod("3M", new Date("2026-09-03T00:00:00Z"))
  qualityOf({ hasValue: true, missingHoldings: 1, stale: false })

  const result = attribute({
    beginningValue: 5_000,
    endingValue: 6_200,
    netFlow: 500,
    holdings: [
      { symbol: "NVDA", market: "US", currency: "USD", beginValue: 3_000, endValue: 3_400, invested: 0, divested: 0, dividends: 0 },
      { symbol: "AAPL", market: "US", currency: "USD", beginValue: 2_000, endValue: 2_800, invested: 500, divested: 0, dividends: 30 },
    ],
  })
  if (result.ok) {
    rankContributors(result.contributions)
    residual(result)
  }

  const drawdowns = drawdownHistory(INDEX)
  regimeOf(drawdowns, 2)
}

describe("historical analysis is a read", () => {
  it("leaves holdings, cost basis, P&L and cash byte-identical", () => {
    const before = financialState()
    everyHistoricalOperation()
    expect(financialState()).toBe(before)
  })

  it("is stable when every operation runs repeatedly", () => {
    const before = financialState()
    for (let i = 0; i < 5; i += 1) everyHistoricalOperation()
    expect(financialState()).toBe(before)
  })

  it("reconstruction never mutates the transactions it replays", () => {
    const before = JSON.stringify(TRANSACTIONS)
    for (const date of ["2026-01-15", "2026-03-15", "2026-12-31"]) reconstructAt(INPUT, date)
    expect(JSON.stringify(TRANSACTIONS)).toBe(before)
  })

  it("attribution never mutates the holdings it measures", () => {
    const holdings = [
      { symbol: "NVDA", market: "US", currency: "USD" as const, beginValue: 3_000, endValue: 3_400, invested: 0, divested: 0, dividends: 0 },
    ]
    const before = JSON.stringify(holdings)
    attribute({ beginningValue: 3_000, endingValue: 3_400, netFlow: 0, holdings })
    expect(JSON.stringify(holdings)).toBe(before)
  })

  it("drawdown analysis never mutates the series it reads", () => {
    const before = JSON.stringify(INDEX)
    drawdownHistory(INDEX)
    drawdownHistory([...INDEX].reverse())
    expect(JSON.stringify(INDEX)).toBe(before)
  })

  it("creates no transaction, whatever it is asked", () => {
    // The strongest form of the rule: the transaction set the analysis started from is the
    // transaction set it ends with, in the same order.
    const before = [...TRANSACTIONS]
    everyHistoricalOperation()
    expect(TRANSACTIONS).toEqual(before)
    expect(TRANSACTIONS).toHaveLength(4)
  })
})

describe("reconstruction and the live engine cannot disagree", () => {
  it("reconstructing the present reproduces the present exactly", () => {
    // If these diverge, a second engine has been introduced — which is the one thing this whole
    // phase was not allowed to do.
    const state = reconstructAt(INPUT, "2026-12-31")
    const { positions, trades } = replayPortfolio(TRANSACTIONS)
    expect(state.positions).toEqual(positions)
    expect(state.trades).toEqual(trades)
  })

  it("a correction to a transaction changes the reconstruction of that date", () => {
    // The other half of the same property: the history is a *view* of the transactions, so
    // correcting one corrects every figure about it rather than leaving a stored past behind.
    const corrected = [...TRANSACTIONS]
    corrected[0] = tx("NVDA", "buy", 20, 100, 1, "2026-01-10", 1)
    const original = reconstructAt(INPUT, "2026-02-01")
    const after = reconstructAt({ ...INPUT, transactions: corrected }, "2026-02-01")
    expect(after.investedCapital).not.toBe(original.investedCapital)
  })
})

describe("the historical engines cannot reach anything", () => {
  const FORBIDDEN = [
    "@/lib/supabase",
    "supabase",
    "server-only",
    "next/",
    "revalidatePath",
    "fetch(",
    "@/services/",
    "@/features/",
    "process.env",
    "Date.now()",
  ]

  for (const file of ["history.ts", "attribution.ts", "drawdown-history.ts"]) {
    const contents = readFileSync(join(process.cwd(), "domain", file), "utf8")

    for (const needle of FORBIDDEN) {
      it(`domain/${file} never mentions ${needle}`, () => {
        expect(contents.includes(needle)).toBe(false)
      })
    }

    it(`domain/${file} imports only from domain/`, () => {
      // Anchored to real import statements: the loose form matches prose inside comments, which is
      // how this test first "found" an import of "the portfolio was fed".
      const imports = [...contents.matchAll(/^import[^\n]*? from "([^"]+)"/gm)].map((m) => m[1])
      for (const specifier of imports) {
        expect(specifier.startsWith("./"), `${file} imports ${specifier}`).toBe(true)
      }
    })
  }
})

describe("no calculation module imports the historical layer", () => {
  /** The dependency runs one way, as it does for intelligence, simulation, sharing and preferences. */
  for (const engine of ["holdings.ts", "cash.ts", "dividends.ts", "money.ts", "analytics.ts", "returns.ts"]) {
    it(`${engine} does not import history or attribution`, () => {
      const contents = readFileSync(join(process.cwd(), "domain", engine), "utf8")
      for (const layer of ["history", "attribution", "drawdown-history"]) {
        expect(contents.includes(`from "./${layer}"`), `${engine} → ${layer}`).toBe(false)
      }
    })
  }
})
