import { describe, expect, it } from "vitest"
import { reconcile, type ExistingTransaction } from "./reconcile"
import { fingerprintFor } from "./validate"
import type { NormalizedRow } from "./types"

const PORTFOLIO = "11111111-1111-4111-8111-111111111111"

const row = (over: Partial<NormalizedRow> = {}): NormalizedRow => ({
  rowNumber: 2,
  tradeDate: "2026-01-02",
  symbol: "NVDA",
  market: "US",
  side: "buy",
  quantity: 10,
  price: 170.25,
  fee: 1.5,
  currency: null,
  notes: null,
  reference: null,
  raw: [],
  ...over,
})

/** A stored transaction that would have been created by importing `source`. */
const stored = (source: NormalizedRow, over: Partial<ExistingTransaction> = {}): ExistingTransaction => ({
  id: `tx-${source.rowNumber}`,
  side: source.side!,
  symbol: source.symbol!,
  market: source.market!,
  tradeDate: source.tradeDate!,
  quantity: source.quantity!,
  price: source.price!,
  fee: source.fee!,
  fingerprint: fingerprintFor(source, PORTFOLIO),
  ...over,
})

describe("matching", () => {
  it("matches a row against the transaction it created", () => {
    const source = row()
    const report = reconcile([source], [stored(source)], PORTFOLIO)
    expect(report.matched).toBe(1)
    expect(report.entries[0].status).toBe("MATCHED")
  })

  it("reports a row Stockly does not have", () => {
    const report = reconcile([row()], [], PORTFOLIO)
    expect(report.missingInStockly).toBe(1)
    expect(report.entries[0].row?.symbol).toBe("NVDA")
  })

  it("reports an imported transaction the file no longer contains", () => {
    const source = row()
    const report = reconcile([], [stored(source)], PORTFOLIO)
    expect(report.missingInSource).toBe(1)
    expect(report.entries[0].existing?.id).toBe("tx-2")
  })

  it("does not call a hand-entered transaction a discrepancy", () => {
    // No fingerprint means it was typed in, not imported. Counting it as missing from the file
    // would bury the real findings under every transaction the user ever entered by hand.
    const report = reconcile([], [stored(row(), { fingerprint: null })], PORTFOLIO)
    expect(report.missingInSource).toBe(0)
    expect(report.unfingerprinted).toBe(1)
  })

  it("reports a row the file lists twice", () => {
    const report = reconcile([row(), row({ rowNumber: 3 })], [], PORTFOLIO)
    expect(report.duplicatesInSource).toBe(1)
    expect(report.missingInStockly).toBe(1)
  })

  it("treats a row too incomplete to identify as missing rather than matching it to anything", () => {
    const report = reconcile([row({ price: null })], [stored(row())], PORTFOLIO)
    expect(report.matched).toBe(0)
    expect(report.missingInStockly).toBe(1)
  })
})

describe("conflicts", () => {
  /**
   * Only reachable through a broker reference: a value-based fingerprint includes every field, so a
   * changed value produces a different key and reads as a new row. A reference-keyed row whose
   * price the broker later corrected is the case this exists for.
   */
  const referenced = row({ reference: "TRADE-9" })

  it("reports a corrected price as a conflict, never as an overwrite", () => {
    const report = reconcile(
      [row({ reference: "TRADE-9", price: 171.5 })],
      [stored(referenced)],
      PORTFOLIO,
    )
    expect(report.conflicts).toBe(1)
    expect(report.entries[0].conflicts).toEqual([
      { field: "price", source: "171.5", stockly: "170.25" },
    ])
  })

  it("shows both sides of every field that differs", () => {
    const report = reconcile(
      [row({ reference: "TRADE-9", quantity: 12, fee: 2, tradeDate: "2026-01-03" })],
      [stored(referenced)],
      PORTFOLIO,
    )
    expect(report.entries[0].conflicts.map((c) => c.field).sort()).toEqual([
      "fee",
      "quantity",
      "tradeDate",
    ])
    for (const conflict of report.entries[0].conflicts) {
      expect(conflict.source).not.toBe(conflict.stockly)
    }
  })

  it("changes nothing — the report is the only output", () => {
    const existing = stored(referenced)
    const before = { ...existing }
    reconcile([row({ reference: "TRADE-9", price: 999 })], [existing], PORTFOLIO)
    expect(existing).toEqual(before)
  })

  it("does not flag a difference that rounds away", () => {
    const report = reconcile(
      [row({ reference: "TRADE-9", price: 170.25 })],
      [stored(referenced, { price: 170.2500000001 })],
      PORTFOLIO,
    )
    expect(report.conflicts).toBe(0)
    expect(report.matched).toBe(1)
  })
})

describe("a whole file", () => {
  it("classifies every row and every stored transaction exactly once", () => {
    const kept = row({ rowNumber: 2 })
    const added = row({ rowNumber: 3, symbol: "AAPL" })
    const removed = row({ rowNumber: 9, symbol: "TSLA" })

    const report = reconcile([kept, added], [stored(kept), stored(removed)], PORTFOLIO)

    expect(report).toMatchObject({
      matched: 1,
      missingInStockly: 1,
      missingInSource: 1,
      conflicts: 0,
      duplicatesInSource: 0,
    })
    expect(report.entries).toHaveLength(3)
  })

  it("is deterministic", () => {
    const rows = [row(), row({ rowNumber: 3, symbol: "AAPL" })]
    const existing = [stored(rows[0])]
    expect(reconcile(rows, existing, PORTFOLIO)).toEqual(reconcile(rows, existing, PORTFOLIO))
  })
})
