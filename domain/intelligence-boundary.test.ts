import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildPortfolio, replayPortfolio } from "./holdings"
import { computeCash } from "./cash"
import type { DomainTransaction } from "./types"

/**
 * The phase 10 invariant, enforced rather than assumed.
 *
 * Journals, theses, goals, benchmarks and insights record what a calculation cannot: the user's
 * reasoning and their targets. **None of them may ever become an input to a financial figure.** If
 * one did, a portfolio's cost basis could change because somebody edited a note — and there would
 * be no way to tell the corrupted number from the real one, because both come out of the same
 * function.
 *
 * Two checks. The first is behavioural: the engine's signatures cannot even express the mistake.
 * The second is structural, and it is the one that will actually catch a regression — it reads the
 * source of every calculation module and fails if one starts importing the intelligence layer.
 */

const DOMAIN = join(process.cwd(), "domain")

/** Every module that produces a number a user could dispute. */
const CALCULATION_MODULES = [
  "holdings.ts",
  "money.ts",
  "cash.ts",
  "dividends.ts",
  "analytics.ts",
  "returns.ts",
  "indicators.ts",
  "technical.ts",
  "screener.ts",
] as const

/** Everything phase 10 added that stores what the user thinks rather than what is true. */
const INTELLIGENCE_MODULES = ["research", "goals", "insights"] as const

const tx = (
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  fee = 0,
  tradeDate = "2026-01-02",
  sequence = 0,
): DomainTransaction => ({ symbol, side, quantity, price, fee, tradeDate, sequence })

describe("the calculation engine cannot see the intelligence layer", () => {
  it.each(CALCULATION_MODULES)("%s imports nothing from journals, theses, goals or insights", (file) => {
    const source = readFileSync(join(DOMAIN, file), "utf8")
    for (const layer of INTELLIGENCE_MODULES) {
      // Matches `from "./insights"`, `from "@/domain/insights"` and the `import(...)` forms.
      const pattern = new RegExp(`from\\s+["'](\\./|@/domain/)${layer}["']|import\\(\\s*["'](\\./|@/domain/)${layer}["']`)
      expect(pattern.test(source), `${file} must not import ${layer}`).toBe(false)
    }
  })

  it("risk.ts reads returns and money, and nothing from the intelligence layer either", () => {
    const source = readFileSync(join(DOMAIN, "risk.ts"), "utf8")
    for (const layer of INTELLIGENCE_MODULES) {
      expect(source).not.toContain(`from "./${layer}"`)
    }
  })

  /**
   * The other direction is allowed and expected: insights and goals *read* the engine's output.
   * Asserted so the test above is understood as a one-way rule rather than a ban on any coupling.
   */
  it("the intelligence layer is allowed to depend on the engine", () => {
    const insights = readFileSync(join(DOMAIN, "insights.ts"), "utf8")
    expect(insights).toContain('from "./money"')
  })
})

describe("the engine's signatures cannot express the mistake", () => {
  const transactions = [
    tx("NVDA", "buy", 10, 170, 1.5, "2026-01-02", 1),
    tx("NVDA", "sell", 4, 200, 1.5, "2026-03-02", 2),
    tx("AAPL", "buy", 20, 200, 1, "2026-02-02", 3),
  ]
  const quote = (symbol: string) => ({ NVDA: { price: 180 }, AAPL: { price: 210 } })[symbol]

  it("produces identical holdings, cost basis and P&L on every call", () => {
    // `buildPortfolio` takes transactions and quotes. There is no parameter a thesis, a goal or a
    // journal entry could be passed through, which is what makes the invariant structural.
    const first = buildPortfolio(transactions, quote)
    const second = buildPortfolio(transactions, quote)
    expect(second).toEqual(first)
  })

  it("derives realised P&L from the transaction, never from a recorded reason", () => {
    const { trades } = replayPortfolio(transactions)
    // 4 shares bought at an average cost of 170.15 and sold at 200 less a 1.5 fee.
    expect(trades).toHaveLength(1)
    expect(trades[0].realizedPnl).toBeCloseTo(4 * 200 - 1.5 - 4 * 170.15, 4)
    // A sell review carries a reason and a note. There is no field on a trade it could write to.
    expect(Object.keys(trades[0])).not.toContain("reason")
    expect(Object.keys(trades[0])).not.toContain("note")
  })

  it("computes cash from movements alone", () => {
    const cash = computeCash(
      transactions,
      [{ kind: "deposit", amount: 10_000, currency: "USD", occurredOn: "2026-01-01" }],
      [],
    )
    // 10,000 deposited, less both buys and their fees, plus the sale proceeds net of its fee.
    expect(cash.balance).toBeCloseTo(
      10_000 - (10 * 170 + 1.5) - (20 * 200 + 1) + (4 * 200 - 1.5),
      4,
    )
  })
})
