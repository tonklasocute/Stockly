import { describe, expect, it } from "vitest"
import { XlsxError, excelSerialToIsoDate, looksLikeXlsx, readWorkbook } from "./xlsx"

/**
 * A workbook written by Python's `zipfile` — an implementation with nothing in common with the
 * reader under test, which is the point. A fixture produced by the same code that reads it would
 * pass whatever both got wrong.
 *
 * It contains, deliberately: shared strings, an inline string, a cached formula result, a
 * built-in date format (14) and a custom one (164), a sparse row with a gap, an entirely empty row,
 * XML entities in a value, and a second sheet written STORED rather than deflated.
 */
const WORKBOOK_BASE64 = "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"

const workbook = () => readWorkbook(Buffer.from(WORKBOOK_BASE64, "base64"))

describe("reading a workbook", () => {
  it("finds every sheet, in workbook order, by name", () => {
    expect(workbook().sheets.map((s) => s.name)).toEqual(["Trades", "Notes"])
  })

  it("reads the header row and the data rows", () => {
    const [trades] = workbook().sheets
    expect(trades.rows[0]).toEqual([
      "Date",
      "Symbol",
      "Side",
      "Quantity",
      "Price",
      "Fee",
      "Currency",
    ])
    expect(trades.rows).toHaveLength(3)
  })

  it("resolves shared strings", () => {
    expect(workbook().sheets[0].rows[1][1]).toBe("NVDA")
  })

  it("reads an inline string", () => {
    expect(workbook().sheets[0].rows[1][6]).toBe("USD")
  })

  it("decodes XML entities, so a company name is not mangled", () => {
    expect(workbook().sheets[0].rows[2][6]).toBe("M&S <test>")
  })

  it("reads a formula's cached value, never the formula", () => {
    // The cell holds `=32*1`; Excel cached 32. That value is what a transaction would be built from.
    expect(workbook().sheets[0].rows[2][4]).toBe("32")
  })

  it("keeps a gap in a sparse row rather than shifting later columns left", () => {
    // Row 3 has no fee cell at all. If it collapsed, the currency would land in the fee column.
    const row = workbook().sheets[0].rows[2]
    expect(row[5]).toBe("")
    expect(row[6]).toBe("M&S <test>")
  })

  it("drops an entirely empty row", () => {
    // The fixture has a bare <row r="4"/>; it is not data and must not become a blank transaction.
    expect(workbook().sheets[0].rows.every((row) => row.some((cell) => cell !== ""))).toBe(true)
  })

  it("reads a STORED entry as readily as a deflated one", () => {
    expect(workbook().sheets[1].rows).toEqual([["Notes"]])
  })

  it("returns every cell as text, leaving interpretation to the import layer", () => {
    for (const sheet of workbook().sheets) {
      for (const row of sheet.rows) {
        for (const cell of row) expect(typeof cell).toBe("string")
      }
    }
  })
})

describe("dates", () => {
  it("converts a serial in both a built-in and a custom date format", () => {
    const rows = workbook().sheets[0].rows
    // 45900 and 45901, verified independently against Python's date arithmetic.
    expect(rows[1][0]).toBe("2025-08-31")
    expect(rows[2][0]).toBe("2025-09-01")
  })

  it("uses the 1899-12-30 epoch", () => {
    expect(excelSerialToIsoDate(45900)).toBe("2025-08-31")
    expect(excelSerialToIsoDate(45292)).toBe("2024-01-01")
  })

  it("refuses a serial inside the Lotus leap-year bug rather than being off by a day", () => {
    // Serial 60 is 1900-02-29, a date that never existed. Anything before 1900-03-01 is refused so
    // the cell keeps its raw value and fails validation loudly.
    expect(excelSerialToIsoDate(1)).toBeNull()
    expect(excelSerialToIsoDate(60)).toBeNull()
    expect(excelSerialToIsoDate(61)).toBe("1900-03-01")
  })

  it("refuses a non-finite or absurd serial", () => {
    expect(excelSerialToIsoDate(Number.NaN)).toBeNull()
    expect(excelSerialToIsoDate(-5)).toBeNull()
    expect(excelSerialToIsoDate(9_999_999)).toBeNull()
  })

  it("drops the time part, because a trade has a date and Stockly stores one", () => {
    expect(excelSerialToIsoDate(45900.75)).toBe("2025-08-31")
  })
})

describe("untrusted input", () => {
  it("rejects a file that is not a zip", () => {
    expect(() => readWorkbook(Buffer.from("Date,Symbol\n2026-01-01,NVDA\n"))).toThrow(XlsxError)
  })

  it("rejects a truncated workbook rather than reading past the end of it", () => {
    const truncated = Buffer.from(WORKBOOK_BASE64, "base64").subarray(0, 600)
    expect(() => readWorkbook(truncated)).toThrow(XlsxError)
  })

  it("rejects an empty buffer", () => {
    expect(() => readWorkbook(Buffer.alloc(0))).toThrow(XlsxError)
  })

  it("carries a code, so a route can map the failure without matching on prose", () => {
    try {
      readWorkbook(Buffer.from("not a zip"))
      throw new Error("expected a throw")
    } catch (error) {
      expect(error).toBeInstanceOf(XlsxError)
      expect((error as XlsxError).code).toBe("NOT_A_ZIP")
    }
  })

  it("recognises the zip signature, so a mislabelled CSV fails with a useful message", () => {
    expect(looksLikeXlsx(Buffer.from(WORKBOOK_BASE64, "base64"))).toBe(true)
    expect(looksLikeXlsx(Buffer.from("Date,Symbol"))).toBe(false)
  })
})
