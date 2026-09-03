import { describe, expect, it } from "vitest"
import {
  DEFAULT_MATRIX_SHOCKS,
  FORBIDDEN_STRESS_PATTERNS,
  STRESS_CALCULATION_VERSION,
  STRESS_DISCLAIMER,
  assumptionsOf,
  describeScenario,
  findForbiddenStressPattern,
  fxOverridesFor,
  historicalScenario,
  priceAdjustmentsFor,
  recoveryGainPct,
  runStress,
  stressMatrix,
  worstRow,
  type StressInput,
} from "./stress"
import type { DrawdownHistory } from "./drawdown-history"
import type { Holding } from "./types"

const holding = (over: Partial<Holding> = {}): Holding => ({
  symbol: "AAPL",
  market: "US",
  currency: "USD",
  quantity: 100,
  investedValue: 15_000,
  averageCost: 150,
  realizedPnl: 0,
  currentPrice: 200,
  marketValue: 20_000,
  unrealizedPnl: 5_000,
  returnPct: 33.33,
  weight: 100,
  todayPnl: null,
  todayReturnPct: null,
  stale: false,
  baseCurrency: "USD",
  fx: { rate: 1, asOf: null, freshness: "fresh", identity: true },
  baseMarketValue: 20_000,
  baseInvestedValue: 15_000,
  baseUnrealizedPnl: 5_000,
  baseTodayPnl: null,
  baseRealizedPnl: 0,
  ...over,
})

/** A Thai holding in a baht-based book, valued at 1 THB = 1 THB. */
const thai = (over: Partial<Holding> = {}): Holding =>
  holding({
    symbol: "PTT",
    market: "SET",
    currency: "THB",
    quantity: 1_000,
    currentPrice: 35,
    marketValue: 35_000,
    investedValue: 30_000,
    averageCost: 30,
    baseCurrency: "THB",
    fx: { rate: 1, asOf: null, freshness: "fresh", identity: true },
    baseMarketValue: 35_000,
    baseInvestedValue: 30_000,
    ...over,
  })

const input = (over: Partial<StressInput> = {}): StressInput => ({
  holdings: [holding()],
  baseCurrency: "USD",
  cash: 0,
  ...over,
})

// ---------------------------------------------------------------- recovery

describe("recoveryGainPct", () => {
  it("is the asymmetry people underestimate", () => {
    expect(recoveryGainPct(-10)).toBeCloseTo(11.111111, 5)
    expect(recoveryGainPct(-20)).toBeCloseTo(25, 6)
    expect(recoveryGainPct(-50)).toBeCloseTo(100, 6)
    expect(recoveryGainPct(-80)).toBeCloseTo(400, 6)
  })

  it("has no answer for a total loss — no finite gain restores nothing", () => {
    expect(recoveryGainPct(-100)).toBeNull()
    expect(recoveryGainPct(-120)).toBeNull()
  })

  it("has no answer when nothing was lost", () => {
    expect(recoveryGainPct(0)).toBeNull()
    expect(recoveryGainPct(15)).toBeNull()
  })

  it("refuses a value that is not a number rather than returning one", () => {
    expect(recoveryGainPct(Number.NaN)).toBeNull()
    expect(recoveryGainPct(Number.POSITIVE_INFINITY)).toBeNull()
  })

  it("actually inverts the fall", () => {
    for (const fall of [-1, -5, -10, -33.3, -75]) {
      const required = recoveryGainPct(fall) as number
      const after = 100 * (1 + fall / 100)
      expect(after * (1 + required / 100)).toBeCloseTo(100, 4)
    }
  })
})

// ---------------------------------------------------------------- builders

describe("priceAdjustmentsFor", () => {
  const book = [holding(), thai(), holding({ symbol: "JPM" })]

  it("applies a uniform shock to everything", () => {
    expect(priceAdjustmentsFor(book, [{ kind: "UNIFORM", changePct: -10 }])).toHaveLength(3)
  })

  it("applies a market shock only to that market", () => {
    const out = priceAdjustmentsFor(book, [{ kind: "MARKET", market: "SET", changePct: -10 }])
    expect(out).toHaveLength(1)
    expect(out[0].symbol).toBe("PTT")
  })

  it("does not apply a US shock to a Thai instrument", () => {
    const out = priceAdjustmentsFor(book, [{ kind: "MARKET", market: "US", changePct: -15 }])
    expect(out.map((a) => a.symbol).sort()).toEqual(["AAPL", "JPM"])
  })

  it("applies a sector shock through the sector map", () => {
    const out = priceAdjustmentsFor(book, [{ kind: "SECTOR", sector: "Technology", changePct: -20 }], {
      "US:AAPL": "Technology",
      "US:JPM": "Financials",
      "SET:PTT": "Energy",
    })
    expect(out).toHaveLength(1)
    expect(out[0].symbol).toBe("AAPL")
  })

  it("never guesses a sector it was not given", () => {
    expect(priceAdjustmentsFor(book, [{ kind: "SECTOR", sector: "Technology", changePct: -20 }])).toEqual([])
  })

  it("targets one instrument by market as well as symbol", () => {
    const both = [holding({ symbol: "PTT", market: "US" }), thai()]
    const out = priceAdjustmentsFor(both, [
      { kind: "INSTRUMENT", symbol: "PTT", market: "SET", changePct: -30 },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].market).toBe("SET")
  })

  /** Two assumptions that both reach a holding are two assumptions, not the last one. */
  it("compounds overlapping components rather than replacing them", () => {
    const out = priceAdjustmentsFor(
      [holding()],
      [
        { kind: "MARKET", market: "US", changePct: -15 },
        { kind: "SECTOR", sector: "Technology", changePct: -20 },
      ],
      { "US:AAPL": "Technology" },
    )
    // 0.85 × 0.80 = 0.68
    expect(out[0].changePct).toBeCloseTo(-32, 6)
  })

  it("never produces a negative price", () => {
    const out = priceAdjustmentsFor([holding()], [{ kind: "UNIFORM", changePct: -150 }])
    expect(out[0].changePct).toBeCloseTo(-100, 6)
  })

  it("leaves a currency component to the FX path", () => {
    expect(priceAdjustmentsFor([holding()], [{ kind: "CURRENCY", currency: "USD", changePct: 10 }])).toEqual([])
  })
})

describe("fxOverridesFor", () => {
  const usdInThb = holding({
    baseCurrency: "THB",
    fx: { rate: 32, asOf: "2026-09-01", freshness: "fresh", identity: false },
    baseMarketValue: 640_000,
  })

  it("moves the rate a currency translates at", () => {
    const overrides = fxOverridesFor([usdInThb], [{ kind: "CURRENCY", currency: "USD", changePct: 10 }], "THB")
    expect(overrides.USD).toBeCloseTo(35.2, 6)
  })

  it("never overrides the base currency — its rate is the identity", () => {
    expect(fxOverridesFor([holding()], [{ kind: "CURRENCY", currency: "USD", changePct: 10 }], "USD")).toEqual({})
  })

  it("cannot invent a rate the portfolio does not have", () => {
    const noRate = holding({ baseCurrency: "THB", fx: null, baseMarketValue: null })
    expect(fxOverridesFor([noRate], [{ kind: "CURRENCY", currency: "USD", changePct: 10 }], "THB")).toEqual({})
  })
})

// ---------------------------------------------------------------- running

describe("runStress", () => {
  it("applies a fall to the portfolio value", () => {
    const result = runStress(input(), {
      name: "-20%",
      type: "UNIFORM_SHOCK",
      components: [{ kind: "UNIFORM", changePct: -20 }],
    })
    expect(result.baseValue).toBe(20_000)
    expect(result.stressedValue).toBe(16_000)
    expect(result.absoluteImpact).toBe(-4_000)
    expect(result.percentageImpact).toBeCloseTo(-20, 6)
  })

  it("reports what it would take to get back", () => {
    const result = runStress(input(), {
      name: "-20%",
      type: "UNIFORM_SHOCK",
      components: [{ kind: "UNIFORM", changePct: -20 }],
    })
    expect(result.recovery?.requiredGainPct).toBeCloseTo(25, 6)
  })

  it("leaves cash alone — a price scenario does not move a bank balance", () => {
    const result = runStress(input({ cash: 5_000 }), {
      name: "-50%",
      type: "UNIFORM_SHOCK",
      components: [{ kind: "UNIFORM", changePct: -50 }],
    })
    expect(result.baseValue).toBe(25_000)
    expect(result.stressedValue).toBe(15_000)
  })

  it("stamps the calculation version and never reads a clock", () => {
    const result = runStress(input(), {
      name: "x",
      type: "UNIFORM_SHOCK",
      components: [{ kind: "UNIFORM", changePct: -10 }],
    })
    expect(result.calculationVersion).toBe(STRESS_CALCULATION_VERSION)
    expect(result.calculatedAt).toBeNull()
    expect(result.dataAsOf).toBeNull()
  })

  it("is deterministic", () => {
    const scenario = {
      name: "x",
      type: "COMBINED_SHOCK" as const,
      components: [
        { kind: "MARKET" as const, market: "US" as const, changePct: -15 },
        { kind: "UNIFORM" as const, changePct: -5 },
      ],
    }
    expect(runStress(input(), scenario)).toEqual(runStress(input(), scenario))
  })

  it("does not mutate the holdings it was handed", () => {
    const holdings = [holding(), thai()]
    const before = structuredClone(holdings)
    runStress(input({ holdings, baseCurrency: "USD" }), {
      name: "x",
      type: "UNIFORM_SHOCK",
      components: [{ kind: "UNIFORM", changePct: -30 }],
    })
    expect(holdings).toEqual(before)
  })
})

describe("coverage", () => {
  const book = [holding(), holding({ symbol: "JPM" }), thai({ baseCurrency: "USD", fx: null, baseMarketValue: null })]

  it("separates what the scenario left alone from what it could not reach", () => {
    const result = runStress(input({ holdings: book }), {
      name: "US -10%",
      type: "MARKET_SHOCK",
      components: [{ kind: "MARKET", market: "US", changePct: -10 }],
    })
    expect(result.coverage.total).toBe(3)
    expect(result.coverage.shocked).toBe(2)
    // The Thai holding has no rate into USD, so it is in no total at all.
    expect(result.coverage.excluded).toEqual([{ symbol: "PTT", market: "SET", reason: "NO_FX_RATE" }])
  })

  it("reports a holding with no sector as excluded, not as unaffected", () => {
    const result = runStress(
      input({ holdings: [holding(), holding({ symbol: "JPM" })], sectors: { "US:AAPL": "Technology" } }),
      {
        name: "Tech -20%",
        type: "SECTOR_SHOCK",
        components: [{ kind: "SECTOR", sector: "Technology", changePct: -20 }],
      },
    )
    expect(result.coverage.shocked).toBe(1)
    expect(result.coverage.excluded).toEqual([{ symbol: "JPM", market: "US", reason: "NO_SECTOR" }])
  })

  it("does not call a correctly-untouched holding a gap", () => {
    const result = runStress(
      input({
        holdings: [holding(), holding({ symbol: "JPM" })],
        sectors: { "US:AAPL": "Technology", "US:JPM": "Financials" },
      }),
      {
        name: "Tech -20%",
        type: "SECTOR_SHOCK",
        components: [{ kind: "SECTOR", sector: "Technology", changePct: -20 }],
      },
    )
    expect(result.coverage.excluded).toEqual([])
    expect(result.coverage.unaffected).toBe(1)
  })
})

describe("component decomposition", () => {
  const scenario = {
    name: "Combined",
    type: "COMBINED_SHOCK" as const,
    components: [
      { kind: "MARKET" as const, market: "US" as const, changePct: -15 },
      { kind: "MARKET" as const, market: "SET" as const, changePct: -10 },
    ],
  }

  const book = [holding(), thai({ baseCurrency: "USD", fx: { rate: 1, asOf: null, freshness: "fresh", identity: false }, baseMarketValue: 35_000 })]

  it("adds up to the whole, exactly", () => {
    const result = runStress(input({ holdings: book }), scenario)
    const sum = result.components.reduce((total, component) => total + component.impact, 0)
    expect(sum).toBeCloseTo(result.absoluteImpact, 6)
  })

  it("names each component and how many positions it moved", () => {
    const result = runStress(input({ holdings: book }), scenario)
    expect(result.components).toHaveLength(2)
    expect(result.components[0].positionsAffected).toBe(1)
    expect(result.components[1].positionsAffected).toBe(1)
  })

  it("does not decompose a single-component scenario into itself", () => {
    const result = runStress(input(), {
      name: "x",
      type: "UNIFORM_SHOCK",
      components: [{ kind: "UNIFORM", changePct: -10 }],
    })
    expect(result.components).toEqual([])
  })
})

describe("stressMatrix", () => {
  it("runs a real calculation per row rather than scaling the first", () => {
    const rows = stressMatrix(input({ cash: 10_000 }))
    expect(rows).toHaveLength(DEFAULT_MATRIX_SHOCKS.length)
    // Cash does not fall, so the portfolio impact is smaller than the shock — which is exactly
    // what scaling one row would have got wrong.
    const ten = rows.find((r) => r.changePct === -10)
    expect(ten?.percentageImpact).toBeCloseTo(-6.666667, 4)
  })

  it("carries the required gain on every row", () => {
    for (const row of stressMatrix(input())) {
      expect(row.requiredGainPct).not.toBeNull()
    }
  })

  it("finds the worst row", () => {
    expect(worstRow(stressMatrix(input()))?.changePct).toBe(-50)
    expect(worstRow([])).toBeNull()
  })
})

describe("historicalScenario", () => {
  const history = (over: Partial<DrawdownHistory["worst"]> = {}): DrawdownHistory => ({
    events: [],
    worst: {
      peakDate: "2026-01-05",
      peakIndex: 120,
      troughDate: "2026-03-10",
      troughIndex: 90,
      depthPct: 25,
      recoveryDate: "2026-06-01",
      declineDays: 45,
      recoveryDays: 60,
      ongoing: false,
      ...over,
    } as DrawdownHistory["worst"],
    currentDepthPct: 0,
    ongoing: null,
    observations: 200,
  })

  /**
   * The trap: `depthPct` is a positive depth. Read straight through, the worst fall in a
   * portfolio's history would be applied as a rally.
   */
  it("turns a positive depth into a negative shock", () => {
    const scenario = historicalScenario(history())
    expect(scenario?.components[0]).toEqual({ kind: "UNIFORM", changePct: -25 })
  })

  it("carries the dates, so a reader can see it is history and not a projection", () => {
    expect(historicalScenario(history())?.note).toContain("2026-01-05")
    expect(historicalScenario(history())?.note).toContain("2026-03-10")
    expect(historicalScenario(history())?.note).toContain("not a statement about what happens next")
  })

  it("says so when the fall has not been recovered", () => {
    expect(historicalScenario(history({ recoveryDate: null }))?.note).toContain("not yet recovered")
  })

  it("invents nothing when there is no history", () => {
    expect(historicalScenario(null)).toBeNull()
    expect(historicalScenario({ events: [], worst: null, currentDepthPct: 0, ongoing: null, observations: 0 })).toBeNull()
  })
})

// ---------------------------------------------------------------- vocabulary

describe("a scenario never claims to know the future", () => {
  it("carries a fixed disclaimer, kept out of the generated prose on purpose", () => {
    // Fixed so it cannot drift, and separate so the blunt patterns below stay blunt.
    expect(STRESS_DISCLAIMER).toBe("Hypothetical scenario — not a forecast.")
  })

  it("says in the assumptions that it claims nothing about the future", () => {
    const lines = assumptionsOf(
      { name: "x", type: "UNIFORM_SHOCK", components: [{ kind: "UNIFORM", changePct: -20 }] },
      "USD",
    )
    expect(lines).toContain("Nothing here is a statement about what happens next.")
  })

  it("explains which way a currency move goes", () => {
    const lines = assumptionsOf(
      { name: "x", type: "CURRENCY_SHOCK", components: [{ kind: "CURRENCY", currency: "USD", changePct: 10 }] },
      "THB",
    )
    expect(lines.some((line) => line.includes("worth more of the portfolio's base currency"))).toBe(true)
  })

  it("says that overlapping assumptions compound and in what order", () => {
    const lines = assumptionsOf(
      {
        name: "x",
        type: "COMBINED_SHOCK",
        components: [
          { kind: "MARKET", market: "US", changePct: -15 },
          { kind: "SECTOR", sector: "Technology", changePct: -20 },
        ],
      },
      "USD",
    )
    expect(lines.some((line) => line.includes("compound"))).toBe(true)
  })

  it("produces no forbidden sentence anywhere in a result", () => {
    const result = runStress(input({ holdings: [holding(), thai({ baseCurrency: "USD", fx: null, baseMarketValue: null })] }), {
      name: "Combined",
      type: "COMBINED_SHOCK",
      components: [
        { kind: "MARKET", market: "US", changePct: -15 },
        { kind: "CURRENCY", currency: "THB", changePct: 8 },
      ],
    })
    const text = [
      ...result.assumptions,
      ...result.components.map((c) => c.label),
      describeScenario(result.scenario),
      ...Object.values(result.scenario),
    ]
      .filter((value) => typeof value === "string")
      .join(" ")

    expect(findForbiddenStressPattern(text)).toBeNull()
  })

  it("has patterns that actually catch the sentences they are for", () => {
    for (const [text, ] of [
      ["The portfolio will recover within a year"],
      ["Expected return is 8%"],
      ["This is our forecast"],
      ["You should sell this position"],
      ["We recommend reducing technology"],
      ["This portfolio is too concentrated"],
      ["Returns are guaranteed"],
      ["It will probably rise"],
    ] as const) {
      expect(findForbiddenStressPattern(text), text).not.toBeNull()
    }
  })

  it("allows the sentences a stress test must be able to say", () => {
    for (const text of [
      "A 20% fall would reduce the modeled portfolio value by $4,000 under the selected assumptions.",
      "Required gain to return to the starting value: 25%.",
      "The deepest fall this portfolio has been through was 25%.",
      "2 holdings are excluded: no sector classification.",
    ]) {
      expect(findForbiddenStressPattern(text), text).toBeNull()
    }
  })

  it("keeps every pattern anchored on a word rather than a fragment", () => {
    // "prediction" must match; "unpredictable weather" in a note must not trip "predict" alone.
    expect(FORBIDDEN_STRESS_PATTERNS.length).toBeGreaterThan(5)
    expect(findForbiddenStressPattern("A holding worth holding")).toBeNull()
  })
})
