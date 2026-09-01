import { describe, expect, it } from "vitest"
import {
  matchesDefinition,
  matchesFilter,
  readMetric,
  runScreen,
  SCREENER_METRICS,
  SCREENER_OPERATORS,
  SCREENER_PRESETS,
  type ScreenerCandidate,
  type ScreenerDefinition,
} from "./screener"
import type { TechnicalSnapshot } from "./technical"

const snapshot = (over: Partial<TechnicalSnapshot> = {}): TechnicalSnapshot => ({
  symbol: "NVDA",
  price: 180,
  asOf: "2026-09-01",
  rsi: 55,
  macd: 1,
  macdSignal: 0.5,
  macdHistogram: 0.5,
  macdCross: null,
  emaCross5020: null,
  emaCross50200: null,
  adx: 30,
  plusDi: 28,
  minusDi: 14,
  atr: 4,
  atrPct: 2.2,
  relativeVolume: 1.6,
  averageVolume: 1_000_000,
  bollingerUpper: 190,
  bollingerMiddle: 180,
  bollingerLower: 170,
  ema: { 20: 175, 50: 170, 100: 160, 200: 150, 9: 178, 150: 155 },
  sma: { 20: 175, 50: 170, 100: 160, 200: 150 },
  trend: "bullish",
  stage: "uptrend",
  signals: [],
  score: 78,
  scoreVersion: "v1",
  components: [],
  candleCount: 260,
  dataIssues: [],
  ...over,
})

const context = { marketCap: 4_000_000_000_000, volume: 42_000_000 }
const candidate = (over: Partial<TechnicalSnapshot> = {}): ScreenerCandidate => ({
  snapshot: snapshot(over),
  context,
})

describe("metric reading", () => {
  it("reads every declared metric without throwing", () => {
    for (const metric of SCREENER_METRICS) {
      expect(() => readMetric(snapshot(), context, metric)).not.toThrow()
    }
  })

  it("expresses price against a moving average as a percentage", () => {
    // 180 vs a 200 EMA of 150 is +20%.
    expect(readMetric(snapshot(), context, "PRICE_VS_EMA200")).toBeCloseTo(20, 6)
  })

  it("returns null when the indicator has no value", () => {
    expect(readMetric(snapshot({ adx: null }), context, "ADX")).toBeNull()
    expect(readMetric(snapshot(), { marketCap: null, volume: null }, "MARKET_CAP")).toBeNull()
  })
})

describe("filters", () => {
  it("matches RSI below a threshold", () => {
    expect(matchesFilter(snapshot({ rsi: 28 }), context, { metric: "RSI", operator: "LT", value: 30 })).toBe(true)
    expect(matchesFilter(snapshot({ rsi: 55 }), context, { metric: "RSI", operator: "LT", value: 30 })).toBe(false)
  })

  it("matches the 50 EMA above the 200 EMA", () => {
    expect(
      matchesFilter(snapshot(), context, { metric: "EMA50_VS_EMA200", operator: "GT", value: 0 }),
    ).toBe(true)
  })

  it("matches relative volume above a multiple", () => {
    expect(
      matchesFilter(snapshot({ relativeVolume: 2.4 }), context, {
        metric: "RELATIVE_VOLUME",
        operator: "GT",
        value: 2,
      }),
    ).toBe(true)
  })

  it("matches a trend by name", () => {
    expect(matchesFilter(snapshot(), context, { metric: "TREND", operator: "EQ", value: "bullish" })).toBe(true)
    expect(matchesFilter(snapshot(), context, { metric: "TREND", operator: "EQ", value: "bearish" })).toBe(false)
  })

  it("excludes a stock whose metric is not computable rather than treating it as zero", () => {
    // A stock with too little history for an RSI is not a stock with an RSI of 0.
    expect(
      matchesFilter(snapshot({ rsi: null }), context, { metric: "RSI", operator: "LT", value: 30 }),
    ).toBe(false)
  })

  it("honours the boundary operators exactly", () => {
    const s = snapshot({ rsi: 30 })
    expect(matchesFilter(s, context, { metric: "RSI", operator: "LT", value: 30 })).toBe(false)
    expect(matchesFilter(s, context, { metric: "RSI", operator: "LTE", value: 30 })).toBe(true)
    expect(matchesFilter(s, context, { metric: "GTE" as never, operator: "GTE", value: 30 })).toBe(false)
  })
})

describe("crossing operators", () => {
  it("matches a MACD cross only on the bar it happened", () => {
    const crossed = snapshot({ macdCross: "bullish" })
    const filter = { metric: "MACD_HISTOGRAM", operator: "CROSS_ABOVE", value: 0 } as const
    expect(matchesFilter(crossed, context, filter)).toBe(true)
    // Histogram still positive the next day, but nothing crossed — the distinction that matters.
    expect(matchesFilter(snapshot({ macdCross: null, macdHistogram: 0.9 }), context, filter)).toBe(false)
  })

  it("matches a golden cross", () => {
    expect(
      matchesFilter(snapshot({ emaCross50200: "bullish" }), context, {
        metric: "EMA50_VS_EMA200",
        operator: "CROSS_ABOVE",
        value: 0,
      }),
    ).toBe(true)
  })

  it("returns false for a crossing operator on a metric that cannot cross", () => {
    expect(
      matchesFilter(snapshot(), context, { metric: "PRICE", operator: "CROSS_ABOVE", value: 100 }),
    ).toBe(false)
  })
})

describe("AND / OR", () => {
  const definition = (logic: "AND" | "OR"): ScreenerDefinition => ({
    logic,
    filters: [
      { metric: "RSI", operator: "LT", value: 30 },
      { metric: "ADX", operator: "GT", value: 25 },
    ],
  })

  it("AND requires every filter", () => {
    expect(matchesDefinition(snapshot({ rsi: 28, adx: 30 }), context, definition("AND"))).toBe(true)
    expect(matchesDefinition(snapshot({ rsi: 55, adx: 30 }), context, definition("AND"))).toBe(false)
  })

  it("OR requires any filter", () => {
    expect(matchesDefinition(snapshot({ rsi: 55, adx: 30 }), context, definition("OR"))).toBe(true)
    expect(matchesDefinition(snapshot({ rsi: 55, adx: 10 }), context, definition("OR"))).toBe(false)
  })

  it("an empty screen matches everything", () => {
    expect(matchesDefinition(snapshot(), context, { logic: "AND", filters: [] })).toBe(true)
  })
})

describe("runScreen", () => {
  const universe = [
    candidate({ symbol: "A", rsi: 25, adx: 30, score: 60 }),
    candidate({ symbol: "B", rsi: 28, adx: 35, score: 80 }),
    candidate({ symbol: "C", rsi: 60, adx: 15, score: 40 }),
    candidate({ symbol: "D", rsi: null, adx: null, score: null, candleCount: 5 }),
  ]

  it("returns only matches, and counts what it examined", () => {
    const result = runScreen(universe, { logic: "AND", filters: [{ metric: "RSI", operator: "LT", value: 30 }] })
    expect(result.matches.map((m) => m.snapshot.symbol)).toEqual(["A", "B"])
    expect(result.examined).toBe(4)
    expect(result.evaluable).toBe(4)
  })

  it("sorts descending by a metric", () => {
    const result = runScreen(universe, {
      logic: "AND",
      filters: [],
      sort: { metric: "TECHNICAL_SCORE", direction: "desc" },
    })
    expect(result.matches.map((m) => m.snapshot.symbol)).toEqual(["B", "A", "C", "D"])
  })

  it("puts unscorable stocks last even in an ascending sort", () => {
    // A stock with no ADX is not the lowest-ADX stock; leading with it would waste the first page.
    const result = runScreen(universe, {
      logic: "AND",
      filters: [],
      sort: { metric: "ADX", direction: "asc" },
    })
    expect(result.matches.at(-1)!.snapshot.symbol).toBe("D")
  })

  it("skips candidates with no usable history", () => {
    const result = runScreen([candidate({ candleCount: 0 })], { logic: "AND", filters: [] })
    expect(result.evaluable).toBe(0)
    expect(result.matches).toHaveLength(0)
  })

  it("returns nothing for an empty universe", () => {
    expect(runScreen([], { logic: "AND", filters: [] }).matches).toEqual([])
  })
})

describe("presets", () => {
  it("are ordinary definitions the user can read and edit", () => {
    for (const preset of SCREENER_PRESETS) {
      expect(preset.definition.filters.length).toBeGreaterThan(0)
      expect(preset.description.length).toBeGreaterThan(10)
      for (const filter of preset.definition.filters) {
        expect(SCREENER_METRICS).toContain(filter.metric)
        expect(SCREENER_OPERATORS).toContain(filter.operator)
      }
    }
  })

  it("the oversold preset finds an oversold stock in an intact uptrend", () => {
    const preset = SCREENER_PRESETS.find((p) => p.id === "oversold")!
    expect(matchesDefinition(snapshot({ rsi: 25 }), context, preset.definition)).toBe(true)
    expect(matchesDefinition(snapshot({ rsi: 25, price: 100 }), context, preset.definition)).toBe(false)
  })
})

describe("security", () => {
  it("rejects an unknown metric instead of evaluating it", () => {
    const injected = { metric: "PRICE; DROP TABLE alerts", operator: "GT", value: 0 } as never
    // Nothing is interpreted: an unrecognised metric simply reads as null and matches nothing.
    expect(matchesFilter(snapshot(), context, injected)).toBe(false)
  })

  it("rejects an unknown operator", () => {
    const injected = { metric: "RSI", operator: "OR 1=1", value: 0 } as never
    expect(matchesFilter(snapshot(), context, injected)).toBeFalsy()
  })

  it("never treats a filter value as code", () => {
    const injected = { metric: "RSI", operator: "LT", value: "1; SELECT * FROM users" } as never
    // A non-numeric value against a numeric metric cannot match; it is never executed.
    expect(matchesFilter(snapshot(), context, injected)).toBe(false)
  })

  it("keeps the metric and operator vocabularies closed", () => {
    expect(SCREENER_METRICS).not.toContain("__proto__" as never)
    expect(SCREENER_OPERATORS.every((op) => /^[A-Z_]+$/.test(op))).toBe(true)
  })
})
