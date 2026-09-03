import { describe, expect, it } from "vitest"
import {
  assessCompleteness,
  detectIntent,
  extractSymbols,
  findAdviceLanguage,
  FORBIDDEN_PATTERNS,
  MAX_SYMBOLS_PER_REQUEST,
  summarizeHistory,
} from "./ai"
import type { Candle } from "./indicators"

const UNIVERSE = new Set(["NVDA", "AMD", "TSLA", "AAPL", "MSFT", "IT", "ALL"])

describe("detectIntent", () => {
  it("routes portfolio, watchlist and market questions", () => {
    expect(detectIntent("analyze my portfolio")).toBe("PORTFOLIO_ANALYSIS")
    expect(detectIntent("explain my watchlist")).toBe("WATCHLIST_ANALYSIS")
    expect(detectIntent("how does the market look today")).toBe("MARKET_SUMMARY")
  })

  it("treats two or more symbols as a comparison, with or without the word", () => {
    expect(detectIntent("compare NVDA and AMD", 2)).toBe("STOCK_COMPARISON")
    expect(detectIntent("NVDA AMD", 2)).toBe("STOCK_COMPARISON")
    expect(detectIntent("NVDA vs AMD", 0)).toBe("STOCK_COMPARISON")
  })

  it("separates an indicator question about a stock from one about the indicator", () => {
    expect(detectIntent("why is NVDA's RSI so low", 1)).toBe("TECHNICAL_EXPLANATION")
    expect(detectIntent("what does RSI measure", 0)).toBe("INDICATOR_EXPLANATION")
    expect(detectIntent("why is the technical score 78", 1)).toBe("TECHNICAL_EXPLANATION")
  })

  it("falls back to general research rather than guessing", () => {
    expect(detectIntent("hello", 0)).toBe("GENERAL_RESEARCH")
    expect(detectIntent("what should I do with my life", 0)).toBe("GENERAL_RESEARCH")
  })

  it("routes a bare symbol question to stock analysis", () => {
    expect(detectIntent("tell me about NVDA", 1)).toBe("STOCK_ANALYSIS")
  })
})

describe("extractSymbols", () => {
  it("finds lowercase tickers and uppercases them", () => {
    expect(extractSymbols("compare nvda amd tsla", UNIVERSE).symbols).toEqual(["NVDA", "AMD", "TSLA"])
  })

  it("never returns a symbol outside the supported universe", () => {
    const result = extractSymbols("what about ABCXYZ", UNIVERSE)
    expect(result.symbols).toEqual([])
  })

  it("reports an explicit $TICKER that is not supported, so the user can be told", () => {
    const result = extractSymbols("analyse $ABCXYZ please", UNIVERSE)
    expect(result.symbols).toEqual([])
    expect(result.unknown).toEqual(["ABCXYZ"])
  })

  it("does not mistake common English words for tickers", () => {
    // Both IT and ALL are in the universe, and neither is what the user meant.
    expect(extractSymbols("is IT all worth it", UNIVERSE).symbols).toEqual([])
  })

  it("still resolves a lookalike when it is written as an explicit ticker", () => {
    expect(extractSymbols("how is $IT doing", UNIVERSE).symbols).toEqual(["IT"])
  })

  it("deduplicates and caps the number of symbols", () => {
    const many = new Set(["A1", "B2", "C3", "D4", "E5", "F6", "G7"])
    const question = "A1 B2 C3 D4 E5 F6 G7 A1"
    expect(extractSymbols(question, many).symbols).toHaveLength(MAX_SYMBOLS_PER_REQUEST)
  })
})

describe("findAdviceLanguage", () => {
  it("catches trade instructions", () => {
    expect(findAdviceLanguage("You should buy NVDA now.")).not.toHaveLength(0)
    expect(findAdviceLanguage("I recommend selling half your position.")).not.toHaveLength(0)
    expect(findAdviceLanguage("Buy it now while it is cheap.")).not.toHaveLength(0)
  })

  it("catches ratings, targets, guarantees and forecasts", () => {
    expect(findAdviceLanguage("This is a strong buy.")).not.toHaveLength(0)
    expect(findAdviceLanguage("Price target of $250.")).not.toHaveLength(0)
    expect(findAdviceLanguage("This trade is risk-free.")).not.toHaveLength(0)
    expect(findAdviceLanguage("The stock will definitely rise next week.")).not.toHaveLength(0)
    expect(findAdviceLanguage("It is going to crash.")).not.toHaveLength(0)
  })

  it("leaves descriptive language alone", () => {
    expect(
      findAdviceLanguage(
        "RSI is 28, below the configured oversold threshold of 30. ADX at 31 indicates a strong " +
          "trend. Relative volume is 2.1x its average. This describes recent price action and does " +
          "not oblige the price to do anything.",
      ),
    ).toEqual([])
    expect(findAdviceLanguage("Something a holder may wish to monitor.")).toEqual([])
  })

  it("every pattern carries a reason, so a violation can be logged meaningfully", () => {
    for (const rule of FORBIDDEN_PATTERNS) expect(rule.reason.length).toBeGreaterThan(0)
  })
})

describe("assessCompleteness", () => {
  it("reports coverage and names what is missing", () => {
    // Codes, not words, since phase 21: these are rendered on screen and so must be translatable.
    const result = assessCompleteness([
      { ref: { code: "price", symbol: "NVDA" }, available: true },
      { ref: { code: "indicators", symbol: "NVDA" }, available: true },
      { ref: { code: "score", symbol: "NVDA" }, available: false },
      { ref: { code: "volume", symbol: "NVDA" }, available: true },
    ])
    expect(result.coveragePct).toBe(75)
    expect(result.level).toBe("partial")
    expect(result.missing).toEqual([{ code: "score", symbol: "NVDA" }])
  })

  it("is high only when nearly everything arrived", () => {
    expect(assessCompleteness([{ ref: { code: "price" }, available: true }]).level).toBe("high")
    expect(
      assessCompleteness([
        { ref: { code: "price" }, available: true },
        { ref: { code: "volume" }, available: false },
        { ref: { code: "score" }, available: false },
      ]).level,
    ).toBe("low")
  })

  it("returns zero coverage rather than dividing by nothing", () => {
    expect(assessCompleteness([])).toEqual({
      coveragePct: 0,
      level: "low",
      available: [],
      missing: [],
    })
  })
})

describe("summarizeHistory", () => {
  const candles = (closes: number[]): Candle[] =>
    closes.map((close, index) => ({
      date: `2026-01-${String((index % 28) + 1).padStart(2, "0")}`,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1000,
    }))

  it("returns null for an empty series rather than a zeroed summary", () => {
    expect(summarizeHistory([])).toBeNull()
  })

  it("reduces a long series to a handful of facts", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i)
    const summary = summarizeHistory(candles(closes))!

    expect(summary.bars).toBe(300)
    expect(summary.high52w).toBe(399)
    expect(summary.changePct).toBeCloseTo(299, 5)
    expect(summary.fromHighPct).toBe(0)
    // 21 bars back is 378; the return is measured from there.
    expect(summary.return1mPct).toBeCloseTo(((399 - 378) / 378) * 100, 6)
  })

  it("leaves volatility null when there are too few bars to measure it", () => {
    expect(summarizeHistory(candles([10, 11, 12]))!.volatilityPct).toBeNull()
  })

  it("measures the 52-week window over the last year, not the whole series", () => {
    // A high 300 bars ago is outside the window and must not appear as the 52-week high.
    const closes = [500, ...Array.from({ length: 300 }, () => 100)]
    expect(summarizeHistory(candles(closes))!.high52w).toBe(100)
  })
})
