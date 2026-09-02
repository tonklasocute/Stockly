import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildPortfolio, replayPortfolio } from "../holdings"
import { computeCash } from "../cash"
import { scanDataQuality } from "../data-quality"
import { buildPreview, fingerprintFor } from "./validate"
import { normalizeRow, suggestMapping } from "./normalize"
import { reconcile, type ExistingTransaction } from "./reconcile"
import { parseCsv } from "@/lib/csv"
import type { DomainTransaction } from "../types"
import type { ColumnMapping } from "./types"

/**
 * The phase 12 invariants.
 *
 * The one that matters most: **previewing an import changes nothing.** A user is asked to confirm
 * before anything is created, and that promise is only worth making if the act of showing them the
 * preview cannot itself have moved a number. The rest follow the same shape — a scan, a
 * reconciliation and a parse are all reads.
 *
 * A structural check backs the behavioural ones: the import engine is read for a client, a writer
 * or a fetch, the same way the simulation engine is.
 */

const IMPORT_DIR = join(process.cwd(), "domain", "import")
const PORTFOLIO = "11111111-1111-4111-8111-111111111111"

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
const CASH = [
  { kind: "deposit" as const, amount: 10_000, currency: "USD" as const, occurredOn: "2026-01-01" },
]
const quote = (symbol: string) => ({ NVDA: { price: 180 }, AAPL: { price: 210 } })[symbol]

const FILE = [
  "Date,Symbol,Side,Quantity,Price,Fee",
  "2026-04-01,MSFT,BUY,5,400,1",
  "2026-04-02,TSLA,SELL,2,250,1",
  "2026-04-03,BAD,BUY,-1,10,0",
].join("\n")

function normalizedFromFile() {
  const parsed = parseCsv(FILE)
  const mapping: ColumnMapping[] = suggestMapping(parsed.rows[0])
  return parsed.rows.slice(1).map((row, index) => normalizeRow(row, mapping, index + 2))
}

describe("previewing an import changes nothing", () => {
  it("leaves holdings, cost basis, P&L and cash byte-identical", () => {
    const before = buildPortfolio(TRANSACTIONS, quote)
    const cashBefore = computeCash(TRANSACTIONS, CASH, [])
    const tradesBefore = replayPortfolio(TRANSACTIONS).trades

    const holdingsSnapshot = structuredClone(before.holdings)
    const summarySnapshot = structuredClone(before.summary)
    const cashSnapshot = structuredClone(cashBefore)
    const transactionsSnapshot = structuredClone(TRANSACTIONS)

    // The whole pipeline, twice, plus a reconciliation and a data-quality scan.
    const rows = normalizedFromFile()
    for (let run = 0; run < 2; run += 1) {
      buildPreview(rows, { portfolioId: PORTFOLIO, existingFingerprints: new Set() })
      reconcile(rows, [], PORTFOLIO)
      scanDataQuality({
        baseCurrency: "USD",
        holdingsWithoutPrice: [],
        oldestQuoteAgeMinutes: 42,
        missingFxPairs: ["THB/USD"],
        staleFxPairs: [],
        holdingsWithoutMetadata: [],
        unresolvedImportRows: 1,
        importConflicts: 0,
        unverifiedCalendars: [],
        observedAt: "2026-09-02T12:00:00Z",
      })
    }

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

  it("does not mutate the rows it was given", () => {
    const rows = normalizedFromFile()
    const snapshot = structuredClone(rows)
    buildPreview(rows, { portfolioId: PORTFOLIO, existingFingerprints: new Set() })
    reconcile(rows, [], PORTFOLIO)
    expect(rows).toEqual(snapshot)
  })

  it("produces the same preview every time", () => {
    const rows = normalizedFromFile()
    const options = { portfolioId: PORTFOLIO, existingFingerprints: new Set<string>() }
    expect(buildPreview(rows, options)).toEqual(buildPreview(rows, options))
  })
})

describe("applying an import can only add transactions", () => {
  it("re-deriving from the enlarged transaction set is the only way the portfolio moves", () => {
    const rows = normalizedFromFile()
    const preview = buildPreview(rows, {
      portfolioId: PORTFOLIO,
      existingFingerprints: new Set(),
    })

    // What an apply would insert: the CREATE rows, as ordinary transactions.
    const created: DomainTransaction[] = preview.rows
      .filter((r) => r.outcome === "CREATE")
      .map((r, index) => ({
        symbol: r.row.symbol!,
        market: r.row.market!,
        side: r.row.side!,
        tradeDate: r.row.tradeDate!,
        quantity: r.row.quantity!,
        price: r.row.price!,
        fee: r.row.fee!,
        sequence: 100 + index,
      }))

    expect(created).toHaveLength(2) // the invalid row is not among them

    const before = buildPortfolio(TRANSACTIONS, quote)
    const after = buildPortfolio([...TRANSACTIONS, ...created], quote)

    // The existing positions are untouched; only the new instruments appear.
    const nvdaBefore = before.holdings.find((h) => h.symbol === "NVDA")
    const nvdaAfter = after.holdings.find((h) => h.symbol === "NVDA")
    expect(nvdaAfter?.quantity).toBe(nvdaBefore?.quantity)
    expect(nvdaAfter?.investedValue).toBe(nvdaBefore?.investedValue)
    expect(after.holdings.map((h) => h.symbol)).toContain("MSFT")
  })

  it("is idempotent: applying the same file twice leaves the same portfolio", () => {
    const rows = normalizedFromFile()

    const first = buildPreview(rows, { portfolioId: PORTFOLIO, existingFingerprints: new Set() })
    const storedFingerprints = new Set(
      first.rows.filter((r) => r.outcome === "CREATE").map((r) => r.fingerprint!),
    )
    const created: DomainTransaction[] = first.rows
      .filter((r) => r.outcome === "CREATE")
      .map((r, index) => ({
        symbol: r.row.symbol!,
        market: r.row.market!,
        side: r.row.side!,
        tradeDate: r.row.tradeDate!,
        quantity: r.row.quantity!,
        price: r.row.price!,
        fee: r.row.fee!,
        sequence: 100 + index,
      }))

    const afterFirst = buildPortfolio([...TRANSACTIONS, ...created], quote)

    // Second run: every fingerprint already exists, so nothing is created.
    const second = buildPreview(rows, {
      portfolioId: PORTFOLIO,
      existingFingerprints: storedFingerprints,
    })
    expect(second.createCount).toBe(0)
    expect(second.duplicateCount).toBe(2)

    const afterSecond = buildPortfolio([...TRANSACTIONS, ...created], quote)
    expect(afterSecond.holdings).toEqual(afterFirst.holdings)
    expect(afterSecond.summary).toEqual(afterFirst.summary)
  })
})

describe("reconciliation and scanning are reads", () => {
  it("reconciliation does not modify the stored transactions it was given", () => {
    const existing: ExistingTransaction[] = [
      {
        id: "tx-1",
        side: "buy",
        symbol: "MSFT",
        market: "US",
        tradeDate: "2026-04-01",
        quantity: 5,
        price: 400,
        fee: 1,
        fingerprint: fingerprintFor(normalizedFromFile()[0], PORTFOLIO),
      },
    ]
    const snapshot = structuredClone(existing)
    reconcile(normalizedFromFile(), existing, PORTFOLIO)
    expect(existing).toEqual(snapshot)
  })

  it("a data-quality scan with nothing wrong reports nothing, rather than a reassuring score", () => {
    expect(
      scanDataQuality({
        baseCurrency: "USD",
        holdingsWithoutPrice: [],
        oldestQuoteAgeMinutes: 2,
        missingFxPairs: [],
        staleFxPairs: [],
        holdingsWithoutMetadata: [],
        unresolvedImportRows: 0,
        importConflicts: 0,
        unverifiedCalendars: [],
        observedAt: "2026-09-02T12:00:00Z",
      }),
    ).toEqual([])
  })
})

describe("the import engine cannot reach a database", () => {
  const files = readdirSync(IMPORT_DIR).filter(
    (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
  )

  it("has files to check, so the assertions below are not vacuous", () => {
    expect(files.length).toBeGreaterThan(3)
  })

  it.each(files)("%s imports no client, no writer and no framework", (file) => {
    const source = readFileSync(join(IMPORT_DIR, file), "utf8")
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

  it.each(files)("%s declares no mutating call", (file) => {
    const source = readFileSync(join(IMPORT_DIR, file), "utf8")
    for (const forbidden of [/\.insert\s*\(/, /\.update\s*\(/, /\.delete\s*\(/, /\.upsert\s*\(/]) {
      expect(forbidden.test(source), `${file} must not call ${forbidden}`).toBe(false)
    }
  })
})
