import { describe, expect, it } from "vitest"
import type { StockFacts } from "./facts"
import { renderScreenerVocabulary, renderStock } from "./render"

/**
 * Grounding, at the point where it can actually go wrong: the text the model reads.
 *
 * The rule under test is that a missing reading says so. A model handed "RSI: 0" will faithfully
 * describe a stock as maximally oversold, and it will be right to — the context lied to it.
 */

const stock: StockFacts = {
  symbol: "NVDA",
  name: "NVIDIA Corporation",
  currency: "USD",
  price: 185.2,
  previousClose: 183,
  changePct: 1.2,
  quoteAsOf: "2026-09-01T10:30:00Z",
  rsi: 58.4,
  adx: 27.1,
  macdHistogram: 0.42,
  relativeVolume: 1.63,
  atrPct: 2.4,
  ema50: 178.1,
  ema200: 160.4,
  trend: "bullish",
  stage: "uptrend",
  score: 78,
  scoreVersion: "v1",
  components: [
    { key: "trend", label: "Trend", points: 25, max: 25, reason: "price above the 200 EMA" },
  ],
  signals: ["Price above the 200 EMA"],
  candleCount: 250,
  indicatorsAsOf: "2026-09-01T10:00:00Z",
  indicatorsDelayed: false,
  history: null,
  position: null,
  watched: true,
}

const missing: StockFacts = {
  ...stock,
  price: null,
  changePct: null,
  rsi: null,
  adx: null,
  macdHistogram: null,
  relativeVolume: null,
  atrPct: null,
  ema50: null,
  ema200: null,
  score: null,
  components: [],
  signals: [],
  indicatorsAsOf: null,
  indicatorsDelayed: true,
}

describe("renderStock", () => {
  it("quotes the figures it was given, unchanged", () => {
    const text = renderStock(stock)
    expect(text).toContain("RSI (14): 58.4")
    expect(text).toContain("ADX (14): 27.1")
    expect(text).toContain("Technical score: 78/100 (v1)")
    expect(text).toContain("Relative volume: 1.63x")
    expect(text).toContain("185.20 USD")
  })

  it("renders a missing reading as unavailable — never as zero", () => {
    const text = renderStock(missing)
    for (const label of ["Price", "RSI (14)", "ADX (14)", "Relative volume", "Technical score"]) {
      expect(text).toContain(`${label}: unavailable`)
    }
    expect(text).not.toMatch(/RSI \(14\): 0\b/)
    expect(text).not.toMatch(/Technical score: 0/)
  })

  it("says when indicators are delayed, so a stale reading is never presented as live", () => {
    expect(renderStock(missing)).toContain("Indicators delayed: yes")
    expect(renderStock(stock)).toContain("Indicators delayed: no")
  })

  it("carries the score breakdown, so an explanation cannot be invented", () => {
    expect(renderStock(stock)).toContain("Trend: 25/25 — price above the 200 EMA")
  })

  it("states plainly when the user does not hold the stock", () => {
    expect(renderStock(stock)).toContain("The user does not hold this stock.")
    expect(
      renderStock({
        ...stock,
        position: {
          quantity: 10,
          averageCost: 150,
          marketValue: 1852,
          unrealizedPnl: 352,
          returnPct: 23.5,
          weightPct: 12.4,
        },
      }),
    ).toContain("The user holds this stock")
  })
})

describe("renderScreenerVocabulary", () => {
  it("lists only metrics and operators the engine already knows", () => {
    const text = renderScreenerVocabulary()
    expect(text).toContain("RSI")
    expect(text).toContain("CROSS_ABOVE")
    // Nothing that would suggest an expression language exists.
    expect(text).not.toMatch(/\bSQL\b|\bselect\b|\bwhere\b/i)
  })
})
