import { describe, expect, it } from "vitest"
import {
  describeAlert,
  evaluateAlert,
  idempotencyKeyFor,
  messageFor,
  readingFor,
  symbolsToFetch,
  type AlertRule,
  type AlertType,
  type PortfolioReading,
  type QuoteReading,
} from "./alerts"

const NOW = new Date("2026-09-01T15:00:00Z")
const FRESH = "2026-09-01T14:58:00Z"
const STALE = "2026-09-01T14:00:00Z"

const alert = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: "a1",
  type: "PRICE_ABOVE",
  symbol: "NVDA",
  targetValue: 200,
  enabled: true,
  state: "armed",
  lastValue: null,
  lastTriggeredAt: null,
  cooldownMinutes: 60,
  ...over,
})

const ctx = (over: Partial<Parameters<typeof evaluateAlert>[2]> = {}) => ({
  now: NOW,
  marketOpen: true as boolean | null,
  ...over,
})

const reading = (value: number, asOf = FRESH) => ({ value, asOf })

describe("crossing — PRICE_ABOVE", () => {
  it("does not fire while the price is below the target", () => {
    const out = evaluateAlert(alert(), reading(199), ctx())
    expect(out.action).toBe("arm")
  })

  it("fires when the price crosses the target", () => {
    const out = evaluateAlert(alert({ state: "armed" }), reading(200.01), ctx())
    expect(out.action).toBe("trigger")
    if (out.action === "trigger") {
      expect(out.triggerValue).toBe(200.01)
      expect(out.referenceValue).toBe(200)
      expect(out.nextState).toBe("triggered")
    }
  })

  it("does NOT fire again while the price stays above", () => {
    // 200.01 → 201: still true, but it was already true. This is the bug the state machine exists
    // to prevent: without it, every poll would produce another notification.
    const out = evaluateAlert(alert({ state: "triggered" }), reading(201), ctx())
    expect(out.action).toBe("hold")
  })

  it("re-arms when the price falls back below, and can fire again after that", () => {
    const rearmed = evaluateAlert(alert({ state: "triggered" }), reading(195), ctx())
    expect(rearmed).toMatchObject({ action: "arm", nextState: "armed" })

    const again = evaluateAlert(alert({ state: "armed" }), reading(200.5), ctx())
    expect(again.action).toBe("trigger")
  })

  it("treats a price exactly equal to the target as not crossed", () => {
    // "Above 200" means above 200. 200.00 has not passed it.
    expect(evaluateAlert(alert(), reading(200), ctx()).action).toBe("arm")
  })
})

describe("crossing — PRICE_BELOW", () => {
  const below = (over: Partial<AlertRule> = {}) =>
    alert({ type: "PRICE_BELOW", targetValue: 150, ...over })

  it("does not fire while the price is above the target", () => {
    expect(evaluateAlert(below(), reading(201), ctx()).action).toBe("arm")
  })

  it("fires when the price crosses down through the target", () => {
    expect(evaluateAlert(below(), reading(149), ctx()).action).toBe("trigger")
  })

  it("does not fire again while the price stays below", () => {
    expect(evaluateAlert(below({ state: "triggered" }), reading(140), ctx()).action).toBe("hold")
  })

  it("treats a price exactly equal to the target as not crossed", () => {
    expect(evaluateAlert(below(), reading(150), ctx()).action).toBe("arm")
  })
})

describe("cooldown", () => {
  const justFired = alert({
    state: "armed",
    lastTriggeredAt: "2026-09-01T14:30:00Z", // 30 minutes ago
    cooldownMinutes: 60,
  })

  it("suppresses a fresh crossing inside the quiet window", () => {
    const out = evaluateAlert(justFired, reading(200.5), ctx())
    expect(out).toMatchObject({ action: "hold", nextState: "cooldown" })
  })

  it("allows a crossing once the window has passed", () => {
    const older = alert({ state: "armed", lastTriggeredAt: "2026-09-01T13:00:00Z" })
    expect(evaluateAlert(older, reading(200.5), ctx()).action).toBe("trigger")
  })

  it("still re-arms during cooldown when the condition goes false", () => {
    const out = evaluateAlert(alert({ state: "cooldown", lastTriggeredAt: "2026-09-01T14:55:00Z" }), reading(180), ctx())
    expect(out).toMatchObject({ action: "arm", nextState: "armed" })
  })

  it("honours a zero cooldown", () => {
    const out = evaluateAlert(
      alert({ lastTriggeredAt: "2026-09-01T14:59:59Z", cooldownMinutes: 0 }),
      reading(210),
      ctx(),
    )
    expect(out.action).toBe("trigger")
  })
})

describe("guards", () => {
  it("skips a disabled alert", () => {
    expect(evaluateAlert(alert({ enabled: false }), reading(999), ctx())).toMatchObject({
      action: "skip",
      reason: "disabled",
    })
  })

  it("skips when there is no reading at all", () => {
    expect(evaluateAlert(alert(), null, ctx())).toMatchObject({
      action: "skip",
      reason: "no-reading",
    })
  })

  it("refuses to act on a stale quote", () => {
    // An hour-old price is not evidence that anything crossed just now.
    expect(evaluateAlert(alert(), reading(250, STALE), ctx())).toMatchObject({
      action: "skip",
      reason: "stale-reading",
    })
  })

  it("skips price alerts while the market is closed", () => {
    expect(evaluateAlert(alert(), reading(250), ctx({ marketOpen: false }))).toMatchObject({
      action: "skip",
      reason: "market-closed",
    })
  })

  it("still evaluates when the provider cannot report market status", () => {
    // Unknown is not closed; staleness is the real guard against acting on nothing.
    expect(evaluateAlert(alert(), reading(250), ctx({ marketOpen: null })).action).toBe("trigger")
  })

  it("never evaluates a dividend alert on the schedule — it is raised by the write", () => {
    expect(evaluateAlert(alert({ type: "DIVIDEND_RECEIVED" }), reading(1), ctx())).toMatchObject({
      action: "skip",
      reason: "not-scheduled",
    })
  })
})

describe("idempotency", () => {
  it("produces the same key for the same alert, minute and value", () => {
    const a = idempotencyKeyFor("a1", new Date("2026-09-01T15:00:10Z"), 200.01)
    const b = idempotencyKeyFor("a1", new Date("2026-09-01T15:00:59Z"), 200.01)
    expect(a).toBe(b)
  })

  it("produces a different key in a different minute", () => {
    expect(idempotencyKeyFor("a1", new Date("2026-09-01T15:00:00Z"), 200.01)).not.toBe(
      idempotencyKeyFor("a1", new Date("2026-09-01T15:01:00Z"), 200.01),
    )
  })

  it("produces a different key for a different alert", () => {
    expect(idempotencyKeyFor("a1", NOW, 200)).not.toBe(idempotencyKeyFor("a2", NOW, 200))
  })

  it("includes a key on every trigger", () => {
    const out = evaluateAlert(alert(), reading(200.01), ctx())
    expect(out.action === "trigger" && out.idempotencyKey).toBeTruthy()
  })
})

describe("readings", () => {
  const quotes = new Map<string, QuoteReading>([
    ["NVDA", { symbol: "NVDA", price: 210, previousClose: 200, asOf: FRESH }],
    ["AAPL", { symbol: "AAPL", price: 190, previousClose: null, asOf: FRESH }],
  ])
  const portfolio: PortfolioReading = {
    dailyChangePct: 2.5,
    totalReturnPct: 12,
    weights: { NVDA: 42, AAPL: 18 },
    asOf: FRESH,
  }

  it("reads a price straight from the quote", () => {
    expect(readingFor(alert(), quotes, portfolio)).toEqual({ value: 210, asOf: FRESH })
  })

  it("measures percentage change against the previous close", () => {
    // 200 → 210 is +5%, the documented definition. Session open would give a different answer.
    const out = readingFor(alert({ type: "PERCENT_CHANGE_ABOVE", targetValue: 5 }), quotes, portfolio)
    expect(out?.value).toBeCloseTo(5, 6)
  })

  it("has no percentage reading when the provider gave no previous close", () => {
    const out = readingFor(alert({ type: "PERCENT_CHANGE_ABOVE", symbol: "AAPL" }), quotes, portfolio)
    expect(out).toBeNull()
  })

  it("reads portfolio daily change and total return separately", () => {
    expect(readingFor(alert({ type: "PORTFOLIO_DAILY_CHANGE_ABOVE", symbol: null }), quotes, portfolio)?.value).toBe(2.5)
    expect(readingFor(alert({ type: "PORTFOLIO_TOTAL_RETURN_ABOVE", symbol: null }), quotes, portfolio)?.value).toBe(12)
  })

  it("has no portfolio daily reading when there is no previous close for anything", () => {
    const noDaily = { ...portfolio, dailyChangePct: null }
    expect(readingFor(alert({ type: "PORTFOLIO_DAILY_CHANGE_ABOVE", symbol: null }), quotes, noDaily)).toBeNull()
  })

  it("reads a position weight", () => {
    expect(readingFor(alert({ type: "POSITION_WEIGHT_ABOVE", targetValue: 40 }), quotes, portfolio)?.value).toBe(42)
  })

  it("has no weight reading for a symbol that is not held", () => {
    // Treating "not held" as 0% would fire every weight-below alert for every symbol ever mentioned.
    const out = readingFor(alert({ type: "POSITION_WEIGHT_BELOW", symbol: "TSLA" }), quotes, portfolio)
    expect(out).toBeNull()
  })

  it("returns nothing when there is no portfolio at all", () => {
    expect(readingFor(alert({ type: "PORTFOLIO_TOTAL_RETURN_ABOVE", symbol: null }), quotes, null)).toBeNull()
  })

  it("returns nothing when the symbol has no quote", () => {
    expect(readingFor(alert({ symbol: "ZZZZ" }), quotes, portfolio)).toBeNull()
  })
})

describe("symbol deduplication", () => {
  it("collapses many alerts on the same symbol into one fetch", () => {
    // A hundred users watching NVDA is one upstream call, not a hundred.
    const alerts = Array.from({ length: 100 }, (_, i) => alert({ id: `a${i}`, symbol: "nvda" }))
    expect(symbolsToFetch(alerts)).toEqual(["NVDA"])
  })

  it("ignores disabled alerts and portfolio-level alerts", () => {
    const alerts = [
      alert({ id: "1", symbol: "NVDA" }),
      alert({ id: "2", symbol: "AAPL", enabled: false }),
      alert({ id: "3", symbol: null, type: "PORTFOLIO_TOTAL_RETURN_ABOVE" }),
    ]
    expect(symbolsToFetch(alerts)).toEqual(["NVDA"])
  })

  it("includes symbols needed by weight alerts", () => {
    expect(symbolsToFetch([alert({ type: "POSITION_WEIGHT_ABOVE", symbol: "MSFT" })])).toEqual(["MSFT"])
  })

  it("returns nothing for an empty list", () => {
    expect(symbolsToFetch([])).toEqual([])
  })
})

describe("messages", () => {
  it("names the symbol and price for a price alert — public market data", () => {
    const m = messageFor(alert(), 200.01)
    expect(m.title).toContain("NVDA")
    expect(m.body).toContain("$200.01")
    expect(m.href).toBe("/stocks/NVDA")
  })

  it("never puts a portfolio figure in the message", () => {
    // This text reaches a lock screen. A bystander must not learn what the portfolio is worth.
    for (const type of [
      "PORTFOLIO_DAILY_CHANGE_ABOVE",
      "PORTFOLIO_TOTAL_RETURN_BELOW",
      "POSITION_WEIGHT_ABOVE",
    ] as AlertType[]) {
      const m = messageFor(alert({ type, symbol: type.startsWith("POSITION") ? "NVDA" : null }), 61.5)
      expect(`${m.title} ${m.body}`).not.toMatch(/61|\$|%/)
    }
  })

  it("deep-links each alert type somewhere useful", () => {
    expect(messageFor(alert({ type: "DIVIDEND_RECEIVED", symbol: "AAPL" }), 42.5).href).toBe("/dividends")
    expect(messageFor(alert({ type: "PORTFOLIO_DAILY_CHANGE_ABOVE", symbol: null }), 5).href).toBe("/dashboard")
  })
})

describe("describeAlert", () => {
  it("renders a price rule in currency", () => {
    expect(describeAlert(alert())).toBe("NVDA · price rises above $200.00")
  })

  it("renders a percentage rule in percent", () => {
    expect(describeAlert(alert({ type: "PERCENT_CHANGE_ABOVE", targetValue: 5 }))).toContain("+5.00%")
  })

  it("renders a position weight without a sign — it is a share, not a move", () => {
    expect(describeAlert(alert({ type: "POSITION_WEIGHT_ABOVE", targetValue: 40 }))).toBe(
      "NVDA · position weight rises above 40.00%",
    )
  })

  it("calls a portfolio rule Portfolio, not a symbol", () => {
    expect(describeAlert(alert({ type: "PORTFOLIO_DAILY_CHANGE_BELOW", symbol: null, targetValue: -5 }))).toBe(
      "Portfolio · portfolio daily change falls below −5.00%",
    )
  })
})
