import { describe, expect, it } from "vitest"
import { isValidSymbol, normalizeSymbol, symbolKey, toMarket } from "./symbol"

describe("normalizeSymbol", () => {
  it("uppercases and trims", () => {
    expect(normalizeSymbol("  nvda ")).toBe("NVDA")
    expect(normalizeSymbol("Nvda")).toBe("NVDA")
  })

  it("keeps the punctuation real tickers use", () => {
    expect(normalizeSymbol("brk.b")).toBe("BRK.B")
    expect(normalizeSymbol("rds-a")).toBe("RDS-A")
    expect(normalizeSymbol("p&g")).toBe("P&G")
  })

  it("strips characters no ticker uses", () => {
    expect(normalizeSymbol("nv da!")).toBe("NVDA")
    expect(normalizeSymbol("<script>")).toBe("SCRIPT")
  })

  it("caps the length so a long string cannot reach the provider", () => {
    expect(normalizeSymbol("A".repeat(50))).toHaveLength(20)
  })

  it("returns an empty string for unusable input", () => {
    expect(normalizeSymbol("   ")).toBe("")
    expect(normalizeSymbol("!!!")).toBe("")
  })
})

describe("isValidSymbol", () => {
  it.each(["nvda", "BRK.B", "rds-a"])("accepts %s", (input) => {
    expect(isValidSymbol(input)).toBe(true)
  })

  it.each(["", "   ", "!!!", ".AB"])("rejects %s", (input) => {
    expect(isValidSymbol(input)).toBe(false)
  })
})

describe("symbolKey", () => {
  it("separates the same ticker in different markets", () => {
    expect(symbolKey("cpall", "SET")).not.toBe(symbolKey("cpall", "US"))
  })

  it("collapses spelling differences to one key", () => {
    expect(symbolKey(" nvda ")).toBe(symbolKey("NVDA"))
  })
})

describe("toMarket", () => {
  it("accepts a known market in any case", () => {
    expect(toMarket("set")).toBe("SET")
  })

  it("falls back to US rather than throwing", () => {
    expect(toMarket("mars")).toBe("US")
    expect(toMarket(null)).toBe("US")
  })
})
