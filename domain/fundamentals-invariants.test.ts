import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildPortfolio, replayPortfolio } from "./holdings"
import { computeCash } from "./cash"
import {
  computeGrowth,
  computeMetrics,
  computeTTM,
  FUNDAMENTALS_DISCLAIMER,
  type FinancialStatement,
} from "./fundamentals"
import { computeValuation, valuationContext, VALUATION_DISCLAIMER } from "./valuation"
import {
  dedupeEvents,
  describeEvent,
  dividendFundamentals,
  EVENT_TYPES,
  relevantEvents,
  upcoming,
  type CorporateEvent,
} from "./corporate-events"
import { FORBIDDEN_INSIGHT_PATTERNS } from "./insights"
import type { DomainTransaction } from "./types"

/**
 * The phase 17 invariants.
 *
 * **Fundamental data is reference data about a company. A portfolio is a fact about a user.**
 *
 * The separation is structural — nothing in `financial_statements` or `corporate_events` has a
 * `user_id`, and nothing in these engines takes a transaction — but it is worth proving
 * behaviourally too, because the temptation this layer creates is specific: a dividend *event* looks
 * so much like a dividend *received* that turning one into the other is a plausible refactor. It
 * must never happen. Only a row the user recorded reaches the cash engine.
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
]
const CASH = [
  { kind: "deposit" as const, amount: 5_000, currency: "USD" as const, occurredOn: "2026-01-01" },
]
const DIVIDENDS = [{ netAmount: 30, paidOn: "2026-02-20" }]
const quote = (symbol: string) => ({ NVDA: { price: 180 }, AAPL: { price: 70 } })[symbol]

function financialState(): string {
  const { holdings, summary } = buildPortfolio(TRANSACTIONS, quote)
  const { trades, positions } = replayPortfolio(TRANSACTIONS)
  const cash = computeCash(TRANSACTIONS, CASH, DIVIDENDS)
  return JSON.stringify({ holdings, summary, trades, positions, cash })
}

const statement = (year: number, quarter: number | null = null): FinancialStatement => ({
  symbol: "NVDA",
  market: "US",
  currency: "USD",
  period: {
    type: quarter === null ? "ANNUAL" : "QUARTERLY",
    fiscalYear: year,
    fiscalQuarter: quarter,
    reportDate: null,
    periodEnd: quarter === null ? `${year}-12-31` : `${year}-${String(quarter * 3).padStart(2, "0")}-30`,
  },
  income: { revenue: 1_000, grossProfit: 700, operatingIncome: 400, ebitda: 450, netIncome: 300, eps: 3, epsDiluted: 2.9, sharesDiluted: 100 },
  balance: { totalAssets: 2_000, totalLiabilities: 800, totalEquity: 1_200, cashAndEquivalents: 500, totalDebt: 300, currentAssets: 900, currentLiabilities: 400 },
  cashFlow: { operatingCashFlow: 450, capitalExpenditure: -150, investingCashFlow: null, financingCashFlow: null, dividendsPaid: -50 },
  source: "mock",
  fetchedAt: "2026-09-03T00:00:00.000Z",
})

const dividendEvent: CorporateEvent = {
  symbol: "NVDA",
  market: "US",
  type: "DIVIDEND",
  date: "2026-04-01",
  estimated: false,
  status: "UPCOMING",
  title: "Dividend",
  detail: null,
  amountPerShare: 5,
  currency: "USD",
  ratio: null,
  source: "mock",
  fetchedAt: "2026-09-03T00:00:00.000Z",
}

/** Every fundamental operation the application performs, once each. */
function everyFundamentalOperation(): void {
  const current = statement(2025)
  const previous = statement(2024)
  computeMetrics(current)
  computeGrowth(current, previous)
  computeTTM([1, 2, 3, 4].map((q) => statement(2026, q)))
  computeValuation({
    price: 50,
    sharesOutstanding: 100,
    statement: current,
    dividendPerShare: 1.5,
    priceCurrency: "USD",
  })
  valuationContext(20, [18, 20, 22, 19, 25, 21, 23, 20, 24, 19], "P/E")

  const events = [dividendEvent, { ...dividendEvent, type: "EARNINGS" as const }]
  dedupeEvents(events)
  upcoming(events, new Date("2026-03-01T00:00:00Z"))
  relevantEvents(events, new Set(["US:NVDA"]), new Set(), new Date("2026-03-01T00:00:00Z"))
  dividendFundamentals(
    [{ date: "2026-02-01", amountPerShare: 0.25 }],
    3,
    new Date("2026-09-03T00:00:00Z"),
  )
}

describe("fundamentals cannot change a portfolio", () => {
  it("leaves holdings, cost basis, P&L and cash byte-identical", () => {
    const before = financialState()
    everyFundamentalOperation()
    expect(financialState()).toBe(before)
  })

  it("is stable when every operation runs repeatedly", () => {
    const before = financialState()
    for (let i = 0; i < 5; i += 1) everyFundamentalOperation()
    expect(financialState()).toBe(before)
  })

  it("creates no transaction, whatever it ingests", () => {
    const before = [...TRANSACTIONS]
    everyFundamentalOperation()
    expect(TRANSACTIONS).toEqual(before)
    expect(TRANSACTIONS).toHaveLength(3)
  })

  it("a dividend EVENT does not become a dividend RECEIVED", () => {
    /*
     * The specific temptation this phase creates. A dividend event says the company declared a
     * payment; the dividend the user received is a row they recorded. Ingesting a hundred events
     * must not move the cash balance by a cent.
     */
    const before = computeCash(TRANSACTIONS, CASH, DIVIDENDS)
    const events = Array.from({ length: 100 }, (_, i) => ({
      ...dividendEvent,
      date: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
      amountPerShare: 5,
    }))
    dedupeEvents(events)
    upcoming(events, new Date("2026-01-01T00:00:00Z"), 200)
    expect(computeCash(TRANSACTIONS, CASH, DIVIDENDS)).toEqual(before)
  })

  it("never mutates the statements it reads", () => {
    const input = statement(2025)
    const before = JSON.stringify(input)
    computeMetrics(input)
    computeValuation({ price: 50, sharesOutstanding: 100, statement: input, dividendPerShare: 1, priceCurrency: "USD" })
    expect(JSON.stringify(input)).toBe(before)
  })

  it("never mutates the events it reads", () => {
    const events = [dividendEvent, { ...dividendEvent, estimated: true }]
    const before = JSON.stringify(events)
    dedupeEvents(events)
    relevantEvents(events, new Set(["US:NVDA"]), new Set(), new Date())
    expect(JSON.stringify(events)).toBe(before)
  })
})

describe("the fundamental engines cannot reach anything", () => {
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
  ]

  for (const file of ["fundamentals.ts", "valuation.ts", "corporate-events.ts"]) {
    const contents = readFileSync(join(process.cwd(), "domain", file), "utf8")

    for (const needle of FORBIDDEN) {
      it(`domain/${file} never mentions ${needle}`, () => {
        expect(contents.includes(needle)).toBe(false)
      })
    }

    it(`domain/${file} imports only from domain/`, () => {
      const imports = [...contents.matchAll(/^import[^\n]*? from "([^"]+)"/gm)].map((m) => m[1])
      for (const specifier of imports) {
        expect(specifier.startsWith("./"), `${file} imports ${specifier}`).toBe(true)
      }
    })

    it(`domain/${file} never takes a transaction or a holding`, () => {
      // The structural form of the separation: these engines have no way to receive a portfolio.
      expect(contents.includes("DomainTransaction")).toBe(false)
      expect(contents.includes("Holding")).toBe(false)
      expect(contents.includes("portfolioId")).toBe(false)
      expect(contents.includes("user_id")).toBe(false)
    })
  }
})

describe("no calculation module imports the fundamental layer", () => {
  for (const engine of ["holdings.ts", "cash.ts", "dividends.ts", "money.ts", "analytics.ts", "returns.ts"]) {
    it(`${engine} does not import fundamentals`, () => {
      const contents = readFileSync(join(process.cwd(), "domain", engine), "utf8")
      for (const layer of ["fundamentals", "valuation", "corporate-events"]) {
        expect(contents.includes(`from "./${layer}"`), `${engine} → ${layer}`).toBe(false)
      }
    })
  }
})

describe("the migration keeps fundamentals out of the portfolio", () => {
  const RAW = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260909000000_fundamentals.sql"),
    "utf8",
  )
  /*
   * Comments stripped before scanning, and block comments with them.
   *
   * Necessary rather than fussy: the migration's header explains *why* there is no `user_id`, and
   * a naive search for the string finds the explanation and fails. What is being asserted is the
   * absence of a column, not the absence of the word.
   */
  const SQL = RAW.replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "")
    // `comment on ... is '...'` is documentation stored in the database, not a column either.
    .replace(/comment on[\s\S]*?;/g, "")
  const FLAT = SQL.replace(/[ \t]+/g, " ")

  it("gives neither table a user id", () => {
    // The structural guarantee: reference data about a company has nobody's name on it.
    expect(SQL.includes("user_id")).toBe(false)
  })

  it("never references transactions", () => {
    expect(SQL.includes("public.transactions")).toBe(false)
  })

  it("is readable by signed-in users and writable by none", () => {
    for (const table of ["financial_statements", "corporate_events"]) {
      expect(FLAT).toContain(`alter table public.${table} enable row level security`)
      for (const verb of ["for insert", "for update", "for delete"]) {
        const policies = SQL.split(";").filter(
          (statement) => statement.includes(`on public.${table}`) && statement.includes(verb),
        )
        expect(policies, `${table} ${verb}`).toEqual([])
      }
    }
  })

  it("is never granted to an anonymous role", () => {
    expect(SQL.includes("to anon")).toBe(false)
  })

  it("does not constrain a figure to be positive, because losses are real", () => {
    // Rejecting a negative net income would discard true reports.
    expect(SQL.includes("net_income >= 0")).toBe(false)
    expect(SQL.includes("revenue > 0")).toBe(false)
  })

  it("makes event ingestion idempotent by identity, not by exact date", () => {
    expect(SQL).toContain("create unique index corporate_events_identity_idx")
  })
})

describe("nothing in this layer advises", () => {
  it("uses none of the forbidden vocabulary, anywhere", () => {
    const sentences = [
      FUNDAMENTALS_DISCLAIMER,
      VALUATION_DISCLAIMER,
      ...EVENT_TYPES.map((type) => describeEvent({ ...dividendEvent, type })),
      valuationContext(15, [18, 20, 22, 19, 25, 21, 23, 20, 24, 19], "P/E").description!,
      computeGrowth(statement(2026, 1), statement(2025)).unavailableReason!,
    ]
    for (const sentence of sentences) {
      for (const pattern of FORBIDDEN_INSIGHT_PATTERNS) {
        expect(pattern.test(sentence), `"${sentence}" matched ${pattern}`).toBe(false)
      }
    }
  })
})
