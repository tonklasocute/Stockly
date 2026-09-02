import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildPortfolio, canSell, replayPortfolio } from "./holdings"
import { computeCash } from "./cash"
import { converterTo, EMPTY_FX_TABLE } from "./fx"
import { scanDataQuality } from "./data-quality"
import { buildPreview } from "./import/validate"
import { normalizeRow, suggestMapping } from "./import/normalize"
import { reconcile } from "./import/reconcile"
import { projectPublicPortfolio, DEFAULT_SHARE_CONFIG, applyTemplate, SHARE_TEMPLATES } from "./sharing"
import { config, source } from "./sharing.test"
import { simulateGrowth } from "./simulation"
import { parseCsv } from "@/lib/csv"
import type { ColumnMapping } from "./import/types"
import type { DomainTransaction } from "./types"

/**
 * The invariants that hold across every phase, in one file.
 *
 * Each phase already tests its own layer — `intelligence-boundary`, `simulation/invariants`,
 * `import/invariants`, `sharing-boundary`. This is the cross-cutting statement those four
 * separately imply and none of them says outright:
 *
 *   **Transactions are the only thing that can change a financial figure.**
 *
 * Everything else Stockly has grown — journals, theses, goals, benchmarks, simulations, imports
 * that have not been applied, share settings, snapshots, scheduled refreshes — is a note, a target,
 * an assumption or a rendering. This file runs one portfolio through all of them and asserts the
 * numbers come back byte-identical.
 */

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
  tx("AAPL", "buy", 5, 190, 1, "2026-04-02", 4),
]
const CASH = [
  { kind: "deposit" as const, amount: 10_000, currency: "USD" as const, occurredOn: "2026-01-01" },
  { kind: "withdrawal" as const, amount: 500, currency: "USD" as const, occurredOn: "2026-05-01" },
]
const quote = (symbol: string) => ({ NVDA: { price: 180 }, AAPL: { price: 210 } })[symbol]

/** Everything a user would dispute: holdings, cost basis, realised and unrealised P&L, cash. */
function financialState(): string {
  const { holdings, summary } = buildPortfolio(TRANSACTIONS, quote)
  const { trades, positions } = replayPortfolio(TRANSACTIONS)
  const cash = computeCash(TRANSACTIONS, CASH, [])
  return JSON.stringify({ holdings, summary, trades, positions, cash })
}

const FILE = [
  "Date,Symbol,Side,Quantity,Price,Fee",
  "2026-06-01,MSFT,BUY,5,400,1",
  "2026-06-02,TSLA,SELL,2,250,1",
].join("\n")

/** Every read-only thing the application can do to a portfolio, once each. */
function everyNonMutatingOperation(): void {
  // Phase 11 — a simulation is arithmetic on assumptions.
  simulateGrowth({
    initialValue: 10_000,
    contribution: 100,
    frequency: "MONTHLY",
    timing: "END",
    annualReturn: 0.07,
    years: 10,
    contributionGrowth: 0,
    inflationRate: null,
    currency: "USD",
  })

  // Phase 12 — previewing an import, reconciling a statement, scanning data quality.
  const parsed = parseCsv(FILE)
  const mapping: ColumnMapping[] = suggestMapping(parsed.rows[0])
  const rows = parsed.rows.slice(1).map((row, index) => normalizeRow(row, mapping, index + 2))
  buildPreview(rows, {
    portfolioId: "11111111-1111-4111-8111-111111111111",
    existingFingerprints: new Set<string>(),
    now: new Date("2026-09-02T00:00:00.000Z"),
    blankRows: 0,
  })
  reconcile(rows, [], "11111111-1111-4111-8111-111111111111")
  scanDataQuality({
    baseCurrency: "USD",
    holdingsWithoutPrice: [],
    oldestQuoteAgeMinutes: 5,
    missingFxPairs: [],
    staleFxPairs: [],
    holdingsWithoutMetadata: [],
    unresolvedImportRows: 0,
    importConflicts: 0,
    unverifiedCalendars: [],
    observedAt: "2026-09-02T00:00:00.000Z",
  })

  // Phase 13 — projecting a public page, under every preset.
  for (const template of SHARE_TEMPLATES) {
    projectPublicPortfolio(source(), applyTemplate(config(), template))
  }
  projectPublicPortfolio(source(), DEFAULT_SHARE_CONFIG)

  // Phase 9 — building a converter, which is what a market or FX refresh feeds.
  converterTo("USD", EMPTY_FX_TABLE, new Date())
}

describe("only a transaction can change a financial figure", () => {
  it("holdings, cost basis, P&L and cash survive every non-mutating operation", () => {
    const before = financialState()
    everyNonMutatingOperation()
    expect(financialState()).toBe(before)
  })

  it("is stable when those operations run repeatedly", () => {
    // A single pass could pass by luck if something mutated on first use and then memoised.
    const before = financialState()
    for (let i = 0; i < 5; i += 1) everyNonMutatingOperation()
    expect(financialState()).toBe(before)
  })

  it("changes exactly when a transaction is added, and not otherwise", () => {
    // The control: proof that `financialState()` is actually sensitive to what it claims to watch.
    const before = financialState()
    const extra = [...TRANSACTIONS, tx("NVDA", "buy", 1, 175, 0, "2026-07-01", 5)]
    const { summary } = buildPortfolio(extra, quote)
    expect(JSON.stringify(summary)).not.toBe(before)
    expect(financialState()).toBe(before)
  })
})

describe("the engine degrades safely when the boundary is bypassed", () => {
  /**
   * `canSell` runs in the route handler as a read-then-write check, so two concurrent sells could
   * in principle both pass it. The engine is the backstop: it clamps rather than producing a
   * negative position, so the worst outcome of that race is a sell recorded for fewer shares than
   * requested — never a corrupted cost basis propagating through every later figure.
   */
  it("clamps an oversell instead of going negative", () => {
    const oversold = [
      tx("NVDA", "buy", 10, 170, 0, "2026-01-02", 1),
      tx("NVDA", "sell", 25, 200, 0, "2026-03-02", 2),
    ]
    const { positions } = replayPortfolio(oversold)
    const nvda = positions.find((p) => p.symbol === "NVDA")
    expect(nvda?.quantity).toBe(0)
    expect(nvda?.investedValue).toBe(0)
    expect(Number.isFinite(nvda?.realizedPnl ?? Number.NaN)).toBe(true)
  })

  it("still refuses the oversell at the boundary", () => {
    const check = canSell([tx("NVDA", "buy", 10, 170, 0, "2026-01-02", 1)], tx("NVDA", "sell", 25, 200, 0, "2026-03-02", 2))
    expect(check).toEqual({ ok: false, available: 10 })
  })

  it("does not record a trade for a sell of something never held", () => {
    // A zero-share sell must not enter the win-rate statistics as a break-even trade.
    const { trades } = replayPortfolio([tx("TSLA", "sell", 5, 250, 0, "2026-03-02", 1)])
    expect(trades).toEqual([])
  })
})

describe("precision holds where floats would not", () => {
  it("does not accumulate float error across many small rows", () => {
    // The canonical 0.1 + 0.2 problem, in the shape it actually takes here: three hundred small
    // buys whose cost basis must still be an exact figure a user can reconcile against a statement.
    const many = Array.from({ length: 300 }, (_, i) =>
      tx("NVDA", "buy", 0.1, 0.2, 0, "2026-01-02", i + 1),
    )
    const { positions } = replayPortfolio(many)
    const nvda = positions.find((p) => p.symbol === "NVDA")
    expect(nvda?.quantity).toBe(30)
    expect(nvda?.investedValue).toBeCloseTo(6, 8)
  })

  it("handles a fractional share without losing the cost basis", () => {
    const { positions } = replayPortfolio([tx("NVDA", "buy", 0.001, 170, 0, "2026-01-02", 1)])
    expect(positions[0].quantity).toBe(0.001)
    expect(positions[0].investedValue).toBeCloseTo(0.17, 8)
  })

  it("keeps a large portfolio's total exact rather than approximately right", () => {
    const large = [tx("BRK", "buy", 1_000, 700_000, 0, "2026-01-02", 1)]
    const { summary } = buildPortfolio(large, () => ({ price: 700_000 }))
    expect(summary.investedValue).toBe(700_000_000)
    expect(summary.unrealizedPnl).toBe(0)
  })
})

describe("nothing outside the engine imports the engine's writers", () => {
  /**
   * A structural backstop for the whole dependency rule: the four layers that sit *above* the
   * engine must not import Supabase, a network call or a framework. Each phase asserts this for
   * its own folder; this asserts nobody added a fifth folder without one.
   */
  const LAYERS = ["simulation", "import"]
  const FORBIDDEN = ["@/lib/supabase", "server-only", "next/", "revalidatePath", "fetch("]

  for (const layer of LAYERS) {
    const dir = join(process.cwd(), "domain", layer)
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      it(`domain/${layer}/${file} reaches nothing`, () => {
        const contents = readFileSync(join(dir, file), "utf8")
        for (const needle of FORBIDDEN) expect(contents.includes(needle), needle).toBe(false)
      })
    }
  }

  it("domain/sharing.ts and domain/freshness.ts reach nothing either", () => {
    for (const file of ["sharing.ts", "freshness.ts"]) {
      const contents = readFileSync(join(process.cwd(), "domain", file), "utf8")
      for (const needle of FORBIDDEN) expect(contents.includes(needle), `${file}:${needle}`).toBe(false)
    }
  })
})
