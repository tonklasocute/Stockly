import { describe, expect, it } from "vitest"
import {
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  applyRequestSchema,
  gridSchema,
  mappingSchema,
  previewRequestSchema,
} from "./schema"

const PORTFOLIO = "11111111-1111-4111-8111-111111111111"

const grid = [
  ["Date", "Symbol", "Side", "Quantity", "Price"],
  ["2026-01-02", "NVDA", "BUY", "10", "170"],
]
const mapping = [
  { field: "tradeDate", columnIndex: 0 },
  { field: "symbol", columnIndex: 1 },
  { field: "side", columnIndex: 2 },
  { field: "quantity", columnIndex: 3 },
  { field: "price", columnIndex: 4 },
]

describe("the grid is bounded on every axis", () => {
  it("accepts an ordinary file", () => {
    expect(gridSchema.parse(grid)).toEqual(grid)
  })

  it("refuses more rows than one import may carry", () => {
    const many = Array.from({ length: MAX_IMPORT_ROWS + 1 }, () => ["x"])
    expect(gridSchema.safeParse(many).success).toBe(false)
  })

  it("refuses a row with more columns than a spreadsheet has any business having", () => {
    const wide = [Array.from({ length: MAX_IMPORT_COLUMNS + 1 }, () => "x")]
    expect(gridSchema.safeParse(wide).success).toBe(false)
  })

  it("refuses an enormous cell", () => {
    expect(gridSchema.safeParse([["x".repeat(501)]]).success).toBe(false)
  })

  it("refuses a cell that is not a string, so a nested object cannot arrive", () => {
    expect(gridSchema.safeParse([[{ evil: true }]]).success).toBe(false)
    expect(gridSchema.safeParse([[1234]]).success).toBe(false)
  })
})

describe("mapping", () => {
  it("accepts a field bound to a column, and one bound to nothing", () => {
    expect(
      mappingSchema.parse([
        { field: "symbol", columnIndex: 1 },
        { field: "fee", columnIndex: null },
      ]),
    ).toHaveLength(2)
  })

  it("refuses a field the transaction model does not have", () => {
    expect(mappingSchema.safeParse([{ field: "accountNumber", columnIndex: 0 }]).success).toBe(false)
  })

  it("refuses a column index outside the grid", () => {
    expect(mappingSchema.safeParse([{ field: "symbol", columnIndex: -1 }]).success).toBe(false)
    expect(
      mappingSchema.safeParse([{ field: "symbol", columnIndex: MAX_IMPORT_COLUMNS }]).success,
    ).toBe(false)
  })

  it("refuses a fractional index", () => {
    expect(mappingSchema.safeParse([{ field: "symbol", columnIndex: 1.5 }]).success).toBe(false)
  })
})

describe("preview requests", () => {
  it("requires a portfolio, and one that is a uuid", () => {
    expect(previewRequestSchema.safeParse({ rows: grid, mapping }).success).toBe(false)
    expect(
      previewRequestSchema.safeParse({ portfolioId: "1 OR 1=1", rows: grid, mapping }).success,
    ).toBe(false)
  })

  it("defaults the header row to the first", () => {
    expect(previewRequestSchema.parse({ portfolioId: PORTFOLIO, rows: grid, mapping }).headerRow).toBe(0)
  })
})

describe("apply requests", () => {
  const base = { portfolioId: PORTFOLIO, rows: grid, mapping, filename: "trades.csv", format: "CSV" }

  it("defaults partial import to off — importing some rows is never assumed", () => {
    // Silently importing 95 of 100 rows and reporting success is how a portfolio ends up quietly
    // missing five trades. The user has to ask for it.
    expect(applyRequestSchema.parse(base).allowPartial).toBe(false)
  })

  it("requires a filename and a known format", () => {
    expect(applyRequestSchema.safeParse({ ...base, filename: "" }).success).toBe(false)
    expect(applyRequestSchema.safeParse({ ...base, format: "PDF" }).success).toBe(false)
  })

  it("caps the filename, which is stored and never used as a path", () => {
    expect(applyRequestSchema.safeParse({ ...base, filename: "x".repeat(256) }).success).toBe(false)
  })

  it("accepts a path-like filename without treating it as one", () => {
    // The name is display text. It is stored, shown and never resolved.
    const parsed = applyRequestSchema.parse({ ...base, filename: "../../etc/passwd" })
    expect(parsed.filename).toBe("../../etc/passwd")
  })
})
