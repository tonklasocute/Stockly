import { describe, expect, it } from "vitest"
import { detectDelimiter, parseCsv, stripBom, toCsv } from "./csv"

describe("writing", () => {
  it("escapes a value that would otherwise shift every later column", () => {
    const csv = toCsv(["a", "b"], [["x,y", 'he said "hi"']])
    expect(csv).toContain('"x,y"')
    expect(csv).toContain('"he said ""hi"""')
  })

  it("neutralises a formula so a spreadsheet treats it as text", () => {
    expect(toCsv(["a"], [["=1+1"]])).toContain("'=1+1")
  })
})

describe("delimiter detection", () => {
  it("finds the common ones", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",")
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";")
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t")
    expect(detectDelimiter("a|b|c\n1|2|3")).toBe("|")
  })

  it("ignores delimiters inside quotes", () => {
    // A European export whose names contain commas. Counting them would split every row wrongly.
    expect(detectDelimiter('name;city\n"Smith, John";Bangkok\n"Doe, Jane";Chiang Mai')).toBe(";")
  })

  it("falls back to a comma when there is nothing to go on", () => {
    expect(detectDelimiter("single")).toBe(",")
  })
})

describe("parsing", () => {
  it("reads a plain file", () => {
    expect(parseCsv("a,b\n1,2").rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ])
  })

  it("strips a byte-order mark, which Excel writes and which would corrupt the first header", () => {
    const { rows } = parseCsv("﻿Date,Symbol\n2026-01-02,NVDA")
    expect(rows[0][0]).toBe("Date")
    expect(stripBom("﻿x")).toBe("x")
  })

  it("handles CRLF, LF and a lone CR", () => {
    expect(parseCsv("a,b\r\n1,2\r\n").rows).toHaveLength(2)
    expect(parseCsv("a,b\n1,2\n").rows).toHaveLength(2)
    expect(parseCsv("a,b\r1,2").rows).toHaveLength(2)
  })

  it("keeps a delimiter inside a quoted field", () => {
    expect(parseCsv('a,b\n"x,y",z').rows[1]).toEqual(["x,y", "z"])
  })

  it("keeps a newline inside a quoted field", () => {
    expect(parseCsv('a,b\n"line1\nline2",z').rows[1]).toEqual(["line1\nline2", "z"])
  })

  it("unescapes a doubled quote", () => {
    expect(parseCsv('a\n"he said ""hi"""').rows[1]).toEqual(['he said "hi"'])
  })

  it("preserves empty fields rather than collapsing them", () => {
    // A missing fee must stay in its column, or the currency lands in the fee field.
    expect(parseCsv("a,b,c\n1,,3").rows[1]).toEqual(["1", "", "3"])
  })

  it("drops blank rows and counts them", () => {
    const parsed = parseCsv("a,b\n1,2\n\n , \n3,4\n")
    expect(parsed.rows).toHaveLength(3)
    expect(parsed.blankRows).toBe(2)
  })

  it("does not infer types — every cell comes out as text", () => {
    const { rows } = parseCsv("n,d,b\n0012,2026-01-02,true")
    // A leading zero in an account number survives; turning it into 12 would be data loss.
    expect(rows[1]).toEqual(["0012", "2026-01-02", "true"])
  })

  it("terminates an unclosed quoted field rather than losing the file", () => {
    // The row is still returned, so it can fail validation with its number attached.
    const { rows } = parseCsv('a,b\n"unterminated,2')
    expect(rows).toHaveLength(2)
    expect(rows[1][0]).toBe("unterminated,2")
  })

  it("accepts an explicit delimiter when detection would guess wrong", () => {
    expect(parseCsv("a;b\n1;2", { delimiter: ";" }).rows[1]).toEqual(["1", "2"])
  })

  it("reports the delimiter it used, so the UI can show what it decided", () => {
    expect(parseCsv("a;b\n1;2").delimiter).toBe(";")
  })

  it("round-trips what the writer produced", () => {
    const written = toCsv(["Date", "Notes"], [["2026-01-02", 'A "quoted", multi\nline note']])
    const { rows } = parseCsv(written)
    expect(rows[0]).toEqual(["Date", "Notes"])
    expect(rows[1][1]).toBe('A "quoted", multi\nline note')
  })

  it("handles a file with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2").rows).toHaveLength(2)
  })

  it("returns nothing for an empty input", () => {
    expect(parseCsv("").rows).toEqual([])
    expect(parseCsv("\n\n").rows).toEqual([])
  })
})
