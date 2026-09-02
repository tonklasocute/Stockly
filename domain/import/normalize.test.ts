import { describe, expect, it } from "vitest"
import {
  looksLikeHeader,
  normalizeRow,
  parseCurrency,
  parseDate,
  parseDecimal,
  parseMarket,
  parseSide,
  suggestMapping,
} from "./normalize"
import type { ColumnMapping } from "./types"

describe("decimals", () => {
  it("reads plain numbers", () => {
    expect(parseDecimal("170.25")).toBe(170.25)
    expect(parseDecimal("10")).toBe(10)
    expect(parseDecimal("0")).toBe(0)
  })

  it("reads Anglo thousands separators", () => {
    expect(parseDecimal("1,234.56")).toBe(1234.56)
    expect(parseDecimal("1,234,567.89")).toBe(1234567.89)
  })

  it("reads European decimals", () => {
    expect(parseDecimal("1.234,56")).toBe(1234.56)
    expect(parseDecimal("1,23")).toBe(1.23)
  })

  it("reads a bare thousands group as thousands", () => {
    // 1,234 is ambiguous; the Anglo reading is the commoner file, and it is documented.
    expect(parseDecimal("1,234")).toBe(1234)
  })

  it("strips currency symbols and codes", () => {
    expect(parseDecimal("$1,234.56")).toBe(1234.56)
    expect(parseDecimal("฿32.00")).toBe(32)
    expect(parseDecimal("1234.56 USD")).toBe(1234.56)
  })

  it("reads negatives in both conventions", () => {
    expect(parseDecimal("-5.5")).toBe(-5.5)
    expect(parseDecimal("(1,234.56)")).toBe(-1234.56)
  })

  it("handles the non-breaking space Excel emits", () => {
    expect(parseDecimal("1 234.56")).toBe(1234.56)
  })

  it("is null for anything it cannot read — never zero", () => {
    // Zero here would turn an unreadable price into a free share.
    expect(parseDecimal("")).toBeNull()
    expect(parseDecimal("   ")).toBeNull()
    expect(parseDecimal("n/a")).toBeNull()
    expect(parseDecimal("abc")).toBeNull()
    expect(parseDecimal(null)).toBeNull()
    expect(parseDecimal("1.2.3.4")).toBeNull()
  })
})

describe("dates", () => {
  it("reads ISO, with or without a time part", () => {
    expect(parseDate("2026-01-02")).toBe("2026-01-02")
    expect(parseDate("2026-01-02T14:30:00Z")).toBe("2026-01-02")
  })

  it("reads an unambiguous day/month order", () => {
    expect(parseDate("31/01/2026")).toBe("2026-01-31")
    expect(parseDate("01/31/2026")).toBe("2026-01-31")
    expect(parseDate("2026/01/31")).toBe("2026-01-31")
    expect(parseDate("31.01.2026")).toBe("2026-01-31")
  })

  it("refuses an ambiguous one rather than coin-flipping March against April", () => {
    expect(parseDate("03/04/2026")).toBeNull()
  })

  it("never shifts a date through a timezone", () => {
    // The string is taken apart and reassembled as a string. A Date in the server's zone is how a
    // 2 January trade in Bangkok becomes 1 January in a US datacentre.
    expect(parseDate("2026-01-01")).toBe("2026-01-01")
    expect(parseDate("2026-12-31")).toBe("2026-12-31")
  })

  it("rejects a date that does not exist", () => {
    expect(parseDate("2026-02-31")).toBeNull()
    expect(parseDate("2026-13-01")).toBeNull()
  })

  it("is null for anything unreadable — never today", () => {
    expect(parseDate("")).toBeNull()
    expect(parseDate("last Tuesday")).toBeNull()
    expect(parseDate(null)).toBeNull()
  })
})

describe("sides", () => {
  it("reads the words a broker uses", () => {
    for (const word of ["BUY", "Buy", " buy ", "Bought", "purchase", "B", "LONG"]) {
      expect(parseSide(word)).toBe("buy")
    }
    for (const word of ["SELL", "Sell", "sold", "Sale", "S", "SHORT"]) {
      expect(parseSide(word)).toBe("sell")
    }
  })

  it("is null for anything else, including a transfer", () => {
    // Stockly imports buys and sells; a type it cannot store must not be guessed into one.
    expect(parseSide("TRANSFER")).toBeNull()
    expect(parseSide("DIVIDEND")).toBeNull()
    expect(parseSide("")).toBeNull()
  })
})

describe("markets and currencies", () => {
  it("reads a venue name as a market", () => {
    expect(parseMarket("NASDAQ")).toBe("US")
    expect(parseMarket("nyse")).toBe("US")
    expect(parseMarket("SET")).toBe("SET")
    expect(parseMarket("Thailand")).toBe("SET")
  })

  it("is null for a venue Stockly cannot price", () => {
    expect(parseMarket("XETRA")).toBeNull()
    expect(parseMarket("")).toBeNull()
  })

  it("normalises a currency code", () => {
    expect(parseCurrency(" usd ")).toBe("USD")
    expect(parseCurrency("BTC")).toBeNull()
  })
})

describe("header detection", () => {
  it("suggests a mapping from common header names", () => {
    const mapping = suggestMapping(["Trade Date", "Ticker", "Action", "Qty", "Price", "Commission"])
    const by = (field: string) => mapping.find((m) => m.field === field)?.columnIndex
    expect(by("tradeDate")).toBe(0)
    expect(by("symbol")).toBe(1)
    expect(by("side")).toBe(2)
    expect(by("quantity")).toBe(3)
    expect(by("price")).toBe(4)
    expect(by("fee")).toBe(5)
  })

  it("leaves an unmatched field for the user to fill in", () => {
    const mapping = suggestMapping(["Date", "Symbol"])
    expect(mapping.find((m) => m.field === "fee")?.columnIndex).toBeNull()
  })

  it("does not claim one column for two fields", () => {
    const claimed = suggestMapping(["Date", "Symbol", "Side", "Amount"])
      .map((m) => m.columnIndex)
      .filter((i): i is number => i !== null)
    expect(new Set(claimed).size).toBe(claimed.length)
  })

  it("recognises a header row by having no dates or numbers in it", () => {
    expect(looksLikeHeader(["Date", "Symbol", "Quantity"])).toBe(true)
    expect(looksLikeHeader(["2026-01-02", "NVDA", "10"])).toBe(false)
    expect(looksLikeHeader([])).toBe(false)
  })
})

describe("mapping a row", () => {
  const mapping: ColumnMapping[] = [
    { field: "tradeDate", columnIndex: 0 },
    { field: "symbol", columnIndex: 1 },
    { field: "side", columnIndex: 2 },
    { field: "quantity", columnIndex: 3 },
    { field: "price", columnIndex: 4 },
    { field: "fee", columnIndex: 5 },
    { field: "currency", columnIndex: 6 },
    { field: "market", columnIndex: null },
    { field: "notes", columnIndex: null },
    { field: "reference", columnIndex: null },
  ]

  it("normalises every field in one place", () => {
    const row = normalizeRow(
      ["2026-01-02", " nvda ", "Bought", "1,000", "$170.25", "1.50", "usd"],
      mapping,
      2,
    )
    expect(row).toMatchObject({
      rowNumber: 2,
      tradeDate: "2026-01-02",
      symbol: "NVDA",
      side: "buy",
      quantity: 1000,
      price: 170.25,
      fee: 1.5,
      currency: "USD",
      market: "US",
    })
  })

  it("defaults the market, matching the database column", () => {
    expect(normalizeRow(["2026-01-02", "NVDA", "buy", "1", "1", "0", ""], mapping, 2).market).toBe("US")
  })

  it("treats an absent fee column as no fee, and an unreadable one as unknown", () => {
    const noColumn = mapping.map((m) => (m.field === "fee" ? { ...m, columnIndex: null } : m))
    expect(normalizeRow(["2026-01-02", "NVDA", "buy", "1", "1"], noColumn, 2).fee).toBe(0)
    // Present but unreadable is null, so validation reports it rather than assuming zero.
    expect(normalizeRow(["2026-01-02", "NVDA", "buy", "1", "1", "oops", ""], mapping, 2).fee).toBeNull()
  })

  it("keeps the raw cells for the preview", () => {
    const raw = ["2026-01-02", "NVDA", "buy", "10", "170", "1", "USD"]
    expect(normalizeRow(raw, mapping, 2).raw).toEqual(raw)
  })

  it("leaves a missing cell null rather than shifting a later column into it", () => {
    const row = normalizeRow(["2026-01-02", "NVDA", "buy", "10"], mapping, 2)
    expect(row.price).toBeNull()
    expect(row.currency).toBeNull()
  })
})
