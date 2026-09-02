import { describe, expect, it } from "vitest"
import { buildPreview, fingerprintFor, validateRow } from "./validate"
import { fingerprintOf } from "./fingerprint"
import type { NormalizedRow } from "./types"

const NOW = new Date("2026-09-02T12:00:00Z")
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

const codes = (r: NormalizedRow) => validateRow(r, NOW).map((i) => i.code)

describe("a well-formed row", () => {
  it("has nothing wrong with it", () => {
    expect(validateRow(row(), NOW)).toEqual([])
  })
})

describe("dates", () => {
  it("rejects a missing one", () => {
    expect(codes(row({ tradeDate: null }))).toContain("INVALID_DATE")
  })

  it("rejects one in the future", () => {
    expect(codes(row({ tradeDate: "2030-01-01" }))).toContain("FUTURE_DATE")
  })

  it("allows tomorrow, for a user ahead of the server", () => {
    expect(codes(row({ tradeDate: "2026-09-03" }))).not.toContain("FUTURE_DATE")
  })
})

describe("instruments", () => {
  it("rejects a missing symbol", () => {
    expect(codes(row({ symbol: null }))).toContain("MISSING_REQUIRED_FIELD")
  })

  it("rejects a symbol the market's grammar refuses", () => {
    // A dot is a US convention and not a SET spelling — phase 9's per-market symbol rules.
    expect(codes(row({ symbol: "BRK.B", market: "SET" }))).toContain("INVALID_SYMBOL")
    expect(codes(row({ symbol: "BRK.B", market: "US" }))).not.toContain("INVALID_SYMBOL")
  })

  it("rejects a market Stockly cannot price", () => {
    expect(codes(row({ market: null }))).toContain("INVALID_MARKET")
  })
})

describe("side, quantity, price and fee", () => {
  it("rejects an unreadable side", () => {
    expect(codes(row({ side: null }))).toContain("INVALID_TRANSACTION_TYPE")
  })

  it("rejects a non-positive quantity, and does not flip a negative one", () => {
    // Direction lives in `side`. Guessing that −5 meant a sale would be inventing a trade.
    expect(codes(row({ quantity: -5 }))).toContain("INVALID_QUANTITY")
    expect(codes(row({ quantity: 0 }))).toContain("INVALID_QUANTITY")
    expect(codes(row({ quantity: null }))).toContain("INVALID_QUANTITY")
  })

  it("allows a zero price but not a negative one, matching the database", () => {
    expect(codes(row({ price: 0 }))).not.toContain("INVALID_PRICE")
    expect(codes(row({ price: -1 }))).toContain("INVALID_PRICE")
    expect(codes(row({ price: null }))).toContain("INVALID_PRICE")
  })

  it("allows a zero fee but not a negative one", () => {
    expect(codes(row({ fee: 0 }))).not.toContain("INVALID_FEE")
    expect(codes(row({ fee: -1 }))).toContain("INVALID_FEE")
    expect(codes(row({ fee: null }))).toContain("INVALID_FEE")
  })

  it("rejects notes past the column's limit", () => {
    expect(codes(row({ notes: "x".repeat(501) }))).toContain("NOTES_TOO_LONG")
  })
})

describe("currency", () => {
  it("warns rather than rejects when the file disagrees with the venue", () => {
    // Currency is derived from the market, so a stated one is checked and reported, not stored.
    const issues = validateRow(row({ market: "SET", symbol: "PTT", currency: "USD" }), NOW)
    const mismatch = issues.find((i) => i.code === "CURRENCY_MISMATCH")
    expect(mismatch?.severity).toBe("WARNING")
    expect(mismatch?.message).toContain("THB")
  })

  it("says nothing when it agrees", () => {
    expect(codes(row({ market: "SET", symbol: "PTT", currency: "THB" }))).toEqual([])
  })
})

describe("issues carry a code, a row number and a field", () => {
  it("so a UI can point at the cell and a test need not match on prose", () => {
    const [issue] = validateRow(row({ rowNumber: 42, quantity: -1 }), NOW)
    expect(issue).toMatchObject({ rowNumber: 42, field: "quantity", code: "INVALID_QUANTITY" })
    expect(issue.message).toContain("above zero")
  })
})

describe("fingerprints", () => {
  it("is null for a row too incomplete to identify a transaction", () => {
    expect(fingerprintFor(row({ price: null }), PORTFOLIO)).toBeNull()
  })

  it("is stable across identical rows", () => {
    expect(fingerprintFor(row(), PORTFOLIO)).toBe(fingerprintFor(row(), PORTFOLIO))
  })

  it("differs when any identifying value differs", () => {
    const base = fingerprintFor(row(), PORTFOLIO)
    for (const over of [
      { quantity: 11 },
      { price: 170.26 },
      { fee: 2 },
      { tradeDate: "2026-01-03" },
      { side: "sell" as const },
      { symbol: "AAPL" },
      { market: "SET" as const },
    ]) {
      expect(fingerprintFor(row(over), PORTFOLIO)).not.toBe(base)
    }
  })

  it("is the same trade in a different portfolio", () => {
    expect(fingerprintFor(row(), PORTFOLIO)).not.toBe(fingerprintFor(row(), "other-portfolio"))
  })

  it("ignores the values entirely when the broker supplied a reference", () => {
    // A corrected row must re-import as a duplicate and surface as a conflict, not as a second
    // transaction that doubles the position.
    const original = fingerprintFor(row({ reference: "TRADE-9" }), PORTFOLIO)
    const corrected = fingerprintFor(row({ reference: "TRADE-9", price: 999 }), PORTFOLIO)
    expect(corrected).toBe(original)
  })

  it("is insensitive to how a number was written", () => {
    expect(fingerprintOf({
      portfolioId: PORTFOLIO, side: "buy", symbol: "NVDA", market: "US",
      tradeDate: "2026-01-02", quantity: 10, price: 170.25, fee: 1.5,
    })).toBe(fingerprintOf({
      portfolioId: PORTFOLIO, side: "buy", symbol: "NVDA", market: "US",
      tradeDate: "2026-01-02T00:00:00Z", quantity: 10.0, price: 170.2500, fee: 1.50,
    }))
  })
})

describe("preview", () => {
  const preview = (rows: NormalizedRow[], existing: string[] = []) =>
    buildPreview(rows, {
      portfolioId: PORTFOLIO,
      existingFingerprints: new Set(existing),
      now: NOW,
    })

  it("counts what will happen", () => {
    const result = preview([row(), row({ rowNumber: 3, quantity: -1 })])
    expect(result).toMatchObject({ totalRows: 2, createCount: 1, rejectCount: 1, duplicateCount: 0 })
  })

  it("marks a row already in the portfolio as a duplicate, not a creation", () => {
    const fingerprint = fingerprintFor(row(), PORTFOLIO)!
    const result = preview([row()], [fingerprint])
    expect(result.duplicateCount).toBe(1)
    expect(result.createCount).toBe(0)
    expect(result.rows[0].issues.map((i) => i.code)).toContain("DUPLICATE_TRANSACTION")
  })

  it("catches a row duplicated within the same file", () => {
    const result = preview([row(), row({ rowNumber: 3 })])
    expect(result.createCount).toBe(1)
    expect(result.duplicateCount).toBe(1)
    expect(result.rows[1].issues.map((i) => i.code)).toContain("DUPLICATE_IN_FILE")
  })

  it("does not call a rejected row a duplicate, even when it matches one", () => {
    // The user needs the validation error, not a reassuring "already imported".
    const fingerprint = fingerprintFor(row(), PORTFOLIO)!
    const result = preview([row({ notes: "x".repeat(501) })], [fingerprint])
    expect(result.rejectCount).toBe(1)
    expect(result.duplicateCount).toBe(0)
  })

  it("counts a warning without rejecting the row", () => {
    const result = preview([row({ market: "SET", symbol: "PTT", currency: "USD" })])
    expect(result.createCount).toBe(1)
    expect(result.warningCount).toBe(1)
  })

  it("reports blank rows the parser dropped rather than hiding them", () => {
    expect(
      buildPreview([row()], {
        portfolioId: PORTFOLIO,
        existingFingerprints: new Set(),
        now: NOW,
        blankRows: 3,
      }).blankRows,
    ).toBe(3)
  })

  it("is a pure function of its inputs", () => {
    const rows = [row(), row({ rowNumber: 3, symbol: "AAPL" })]
    expect(preview(rows)).toEqual(preview(rows))
  })
})

describe("idempotency", () => {
  it("creates nothing the second time the same file is previewed against its own result", () => {
    const rows = [row(), row({ rowNumber: 3, symbol: "AAPL" }), row({ rowNumber: 4, side: "sell" })]

    const first = buildPreview(rows, {
      portfolioId: PORTFOLIO,
      existingFingerprints: new Set(),
      now: NOW,
    })
    expect(first.createCount).toBe(3)

    // What applying it would have stored.
    const stored = new Set(
      first.rows.filter((r) => r.outcome === "CREATE").map((r) => r.fingerprint!),
    )

    const second = buildPreview(rows, {
      portfolioId: PORTFOLIO,
      existingFingerprints: stored,
      now: NOW,
    })
    expect(second.createCount).toBe(0)
    expect(second.duplicateCount).toBe(3)
    expect(second.rejectCount).toBe(0)
  })

  it("still creates a genuinely new row on a second import of a changed file", () => {
    const original = [row()]
    const stored = new Set([fingerprintFor(row(), PORTFOLIO)!])
    const withOneMore = [...original, row({ rowNumber: 3, symbol: "AAPL" })]

    const result = buildPreview(withOneMore, {
      portfolioId: PORTFOLIO,
      existingFingerprints: stored,
      now: NOW,
    })
    expect(result.createCount).toBe(1)
    expect(result.duplicateCount).toBe(1)
  })
})
