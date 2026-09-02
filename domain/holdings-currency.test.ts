import { describe, expect, it } from "vitest"
import { buildPortfolio, currencyExposures, priceHoldings, computePositions } from "./holdings"
import { buildFxTable, converterTo, identityConverter, type FxRate } from "./fx"
import { computeCash } from "./cash"
import { allocateByHolding, translateTrades, translateTransactions } from "./analytics"
import { replayPortfolio } from "./holdings"
import type { Currency, MarketId } from "./market"
import type { DomainTransaction } from "./types"

/**
 * The phase 9 test matrix: every combination of portfolio base currency and instrument market,
 * plus the three ways FX can fail.
 *
 *                    USD portfolio      THB portfolio
 *   US stock              ✓                  ✓
 *   SET stock             ✓                  ✓
 *   mixed                 ✓                  ✓
 *   missing FX            ✓                  ✓
 *   stale FX              ✓                  ✓
 *   provider failure      ✓                  ✓
 */

const NOW = new Date("2026-09-02T12:00:00Z")
const FRESH = "2026-09-02T11:45:00Z"
const STALE = "2026-09-02T09:00:00Z"

const USD_THB = 32.45

const rate = (over: Partial<FxRate> = {}): FxRate => ({
  base: "USD",
  quote: "THB",
  rate: USD_THB,
  asOf: FRESH,
  provider: "mock",
  ...over,
})

const tx = (
  symbol: string,
  market: MarketId,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  fee = 0,
  tradeDate = "2026-01-02",
  sequence = 0,
): DomainTransaction => ({ symbol, market, side, quantity, price, fee, tradeDate, sequence })

/** NVDA: 10 shares at $170, now $180. PTT: 1,000 shares at ฿30, now ฿32. */
const NVDA = tx("NVDA", "US", "buy", 10, 170)
const PTT = tx("PTT", "SET", "buy", 1000, 30, 0, "2026-01-03", 1)

const prices: Record<string, number> = { "US:NVDA": 180, "SET:PTT": 32 }
const quote = (symbol: string, market: MarketId) => {
  const price = prices[`${market}:${symbol}`]
  return price === undefined ? undefined : { price }
}

function portfolio(
  transactions: DomainTransaction[],
  baseCurrency: Currency,
  rates: FxRate[] = [rate()],
) {
  return buildPortfolio(transactions, quote, {
    baseCurrency,
    convert: converterTo(baseCurrency, buildFxTable(rates), NOW),
  })
}

// ---------------------------------------------------------------- positions carry their currency

describe("positions", () => {
  it("tags each position with the market it was traded on and that market's currency", () => {
    const positions = computePositions([NVDA, PTT])
    expect(positions).toMatchObject([
      { symbol: "NVDA", market: "US", currency: "USD" },
      { symbol: "PTT", market: "SET", currency: "THB" },
    ])
  })

  it("never merges the same ticker across two venues", () => {
    // If these collapsed into one position, the average cost would be the mean of $170 and ฿30.
    const positions = computePositions([
      tx("XYZ", "US", "buy", 10, 100),
      tx("XYZ", "SET", "buy", 10, 40, 0, "2026-01-03", 1),
    ])
    expect(positions).toHaveLength(2)
    expect(positions.map((p) => p.averageCost)).toEqual([100, 40])
  })

  it("records a realized trade in the currency it was made in", () => {
    const { trades } = replayPortfolio([PTT, tx("PTT", "SET", "sell", 1000, 35, 0, "2026-02-01", 2)])
    expect(trades[0]).toMatchObject({ market: "SET", currency: "THB", realizedPnl: 5000 })
  })

  it("will not let a SET holding cover a sell of the US ticker of the same name", () => {
    const positions = computePositions([
      tx("XYZ", "SET", "buy", 100, 10),
      // Selling 100 of the *US* listing, which is not held. Clamped to zero, not netted off SET.
      tx("XYZ", "US", "sell", 100, 10, 0, "2026-02-01", 1),
    ])
    expect(positions.find((p) => p.market === "SET")?.quantity).toBe(100)
    expect(positions.find((p) => p.market === "US")?.quantity).toBe(0)
  })
})

// ---------------------------------------------------------------- USD portfolio

describe("USD portfolio", () => {
  it("values a US stock without any conversion at all", () => {
    const { holdings, summary } = portfolio([NVDA], "USD")
    expect(holdings[0]).toMatchObject({
      currency: "USD",
      marketValue: 1800,
      baseMarketValue: 1800,
      weight: 100,
    })
    expect(holdings[0].fx).toMatchObject({ rate: 1, identity: true })
    expect(summary).toMatchObject({ currency: "USD", marketValue: 1800, untranslatedCount: 0 })
  })

  it("values a SET stock by converting baht into dollars", () => {
    const { holdings, summary } = portfolio([PTT], "USD")
    // ฿32,000 ÷ 32.45 = $986.13…
    expect(holdings[0].marketValue).toBe(32_000)
    expect(holdings[0].currency).toBe("THB")
    expect(holdings[0].baseMarketValue).toBeCloseTo(32_000 / USD_THB, 4)
    expect(summary.marketValue).toBeCloseTo(32_000 / USD_THB, 4)
  })

  it("weights a mixed portfolio on one scale", () => {
    const { holdings, summary } = portfolio([NVDA, PTT], "USD")
    const total = 1800 + 32_000 / USD_THB
    expect(summary.marketValue).toBeCloseTo(total, 3)
    // Weights are computed in the base currency, so they still sum to 100.
    expect(holdings.reduce((sum, h) => sum + (h.weight ?? 0), 0)).toBeCloseTo(100, 4)
    expect(holdings.find((h) => h.symbol === "NVDA")?.weight).toBeCloseTo((1800 / total) * 100, 3)
  })
})

// ---------------------------------------------------------------- THB portfolio

describe("THB portfolio", () => {
  it("values a SET stock without any conversion at all", () => {
    const { holdings, summary } = portfolio([PTT], "THB")
    expect(holdings[0]).toMatchObject({ baseMarketValue: 32_000, weight: 100 })
    expect(holdings[0].fx?.identity).toBe(true)
    expect(summary).toMatchObject({ currency: "THB", marketValue: 32_000 })
  })

  it("values a US stock by converting dollars into baht", () => {
    const { holdings, summary } = portfolio([NVDA], "THB")
    expect(holdings[0].marketValue).toBe(1800)
    expect(holdings[0].baseMarketValue).toBeCloseTo(1800 * USD_THB, 2)
    expect(summary.marketValue).toBeCloseTo(1800 * USD_THB, 2)
    // The rate used is reported alongside, so the user can check the arithmetic.
    expect(holdings[0].fx).toMatchObject({ rate: USD_THB, asOf: FRESH, identity: false })
  })

  it("translates cost basis and P&L with the same rate as the value", () => {
    const { holdings } = portfolio([NVDA], "THB")
    const h = holdings[0]
    expect(h.baseInvestedValue).toBeCloseTo(1700 * USD_THB, 2)
    expect(h.baseUnrealizedPnl).toBeCloseTo(100 * USD_THB, 2)
    // The percentage is a ratio of two same-currency figures, so it is unchanged by the rate.
    expect(h.returnPct).toBeCloseTo(5.882352941, 6)
  })

  it("reports a mixed portfolio's total in baht", () => {
    const { summary } = portfolio([NVDA, PTT], "THB")
    expect(summary.marketValue).toBeCloseTo(1800 * USD_THB + 32_000, 2)
    expect(summary.untranslatedCount).toBe(0)
  })
})

// ---------------------------------------------------------------- FX failures

describe("missing, stale and unavailable rates", () => {
  it("reports null — never 0 — for a holding it cannot convert", () => {
    const { holdings, summary } = portfolio([NVDA, PTT], "THB", []) // no rates at all
    const nvda = holdings.find((h) => h.symbol === "NVDA")!
    expect(nvda.marketValue).toBe(1800) // the native figure is still exact
    expect(nvda.baseMarketValue).toBeNull()
    expect(nvda.baseUnrealizedPnl).toBeNull()
    // A share of the portfolio nobody can compute is unknown, not zero.
    expect(nvda.weight).toBeNull()
    // The THB holding is unaffected: identity needs no provider.
    expect(holdings.find((h) => h.symbol === "PTT")?.baseMarketValue).toBe(32_000)
    expect(summary).toMatchObject({ marketValue: 32_000, untranslatedCount: 1 })
  })

  it("leaves an untranslatable holding out of the total rather than under-reporting silently", () => {
    const { summary } = portfolio([NVDA, PTT], "THB", [])
    // The total is the baht half only — and untranslatedCount is what makes that honest.
    expect(summary.marketValue).toBe(32_000)
    expect(summary.untranslatedCount).toBe(1)
    expect(summary.holdingsCount).toBe(2)
  })

  it("still converts on a stale rate, and counts it", () => {
    const { holdings, summary } = portfolio([NVDA], "THB", [rate({ asOf: STALE })])
    expect(holdings[0].baseMarketValue).toBeCloseTo(1800 * USD_THB, 2)
    expect(holdings[0].fx?.freshness).toBe("stale")
    expect(summary.fxStaleCount).toBe(1)
    expect(summary.untranslatedCount).toBe(0)
  })

  it("treats an FX provider failure exactly like a missing pair", () => {
    // A failed provider yields an empty table; nothing distinguishes it downstream, by design.
    const failed = buildPortfolio([NVDA], quote, {
      baseCurrency: "THB",
      convert: converterTo("THB", buildFxTable([], ["USD/THB"]), NOW),
    })
    expect(failed.holdings[0].baseMarketValue).toBeNull()
    expect(failed.summary.untranslatedCount).toBe(1)
  })

  it("never separates FX movement from stock performance without historical rates", () => {
    // Stockly stores no past rates, so this is null by construction — not a number to be computed.
    expect(portfolio([NVDA, PTT], "THB").summary.fxEffect).toBeNull()
  })

  it("falls back to the identity converter when no FX layer is wired in at all", () => {
    const { summary } = buildPortfolio([NVDA, PTT], quote, {
      baseCurrency: "USD",
      convert: identityConverter("USD"),
    })
    expect(summary.marketValue).toBe(1800)
    expect(summary.untranslatedCount).toBe(1)
  })
})

// ---------------------------------------------------------------- exposures

describe("currency exposure", () => {
  it("reports each currency natively and translated", () => {
    const { holdings } = portfolio([NVDA, PTT], "THB")
    const exposures = currencyExposures(holdings)
    expect(exposures).toHaveLength(2)

    const usd = exposures.find((e) => e.currency === "USD")!
    expect(usd.nativeValue).toBe(1800)
    expect(usd.baseValue).toBeCloseTo(1800 * USD_THB, 2)
    expect(usd.holdings).toBe(1)

    const thb = exposures.find((e) => e.currency === "THB")!
    expect(thb.nativeValue).toBe(32_000)
    expect(thb.baseValue).toBe(32_000)
    expect(exposures.reduce((sum, e) => sum + (e.weight ?? 0), 0)).toBeCloseTo(100, 4)
  })

  it("reports a null base value for a currency it could not convert", () => {
    const { holdings } = portfolio([NVDA, PTT], "THB", [])
    const usd = currencyExposures(holdings).find((e) => e.currency === "USD")!
    expect(usd.nativeValue).toBe(1800)
    expect(usd.baseValue).toBeNull()
    expect(usd.weight).toBeNull()
  })

  it("has a single row for a single-currency portfolio, which the UI then hides", () => {
    expect(currencyExposures(portfolio([NVDA], "USD").holdings)).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- downstream aggregates

describe("aggregates in the base currency", () => {
  const convert = converterTo("THB", buildFxTable([rate()]), NOW)

  it("restates transactions before anything sums them", () => {
    const [restated] = translateTransactions([NVDA], convert)
    expect(restated.price).toBeCloseTo(170 * USD_THB, 4)
    expect(restated.quantity).toBe(10) // quantity is not money and is never touched
  })

  it("scales a fee by the same rate as the price it belongs to", () => {
    const [restated] = translateTransactions([tx("NVDA", "US", "buy", 10, 170, 2.5)], convert)
    expect(restated.fee).toBeCloseTo(2.5 * USD_THB, 4)
  })

  it("drops a row it cannot restate rather than counting it at par", () => {
    const noRates = converterTo("THB", buildFxTable([]), NOW)
    expect(translateTransactions([NVDA, PTT], noRates)).toHaveLength(1)
    expect(translateTransactions([NVDA, PTT], noRates)[0].symbol).toBe("PTT")
  })

  it("restates realized trades too, so win/loss statistics are one currency", () => {
    const { trades } = replayPortfolio([NVDA, tx("NVDA", "US", "sell", 10, 200, 0, "2026-02-01", 5)])
    const [restated] = translateTrades(trades, convert)
    expect(restated.realizedPnl).toBeCloseTo(300 * USD_THB, 2)
    expect(restated.returnPct).toBeCloseTo(trades[0].returnPct!, 6) // a ratio, unchanged
  })

  it("allocates on base values, so a pie of two currencies is comparable", () => {
    const { holdings } = portfolio([NVDA, PTT], "THB")
    const slices = allocateByHolding(holdings, 0)
    expect(slices.reduce((sum, s) => sum + s.weight, 0)).toBeCloseTo(100, 4)
    expect(slices.find((s) => s.key === "NVDA")?.value).toBeCloseTo(1800 * USD_THB, 2)
  })

  it("leaves an untranslatable holding out of the allocation rather than valuing it at zero", () => {
    const { holdings } = portfolio([NVDA, PTT], "THB", [])
    const slices = allocateByHolding(holdings, 0)
    expect(slices.map((s) => s.key)).toEqual(["PTT"])
  })

  it("computes a cash balance across currencies, dropping what it cannot convert", () => {
    const cash = computeCash(
      [],
      [
        { kind: "deposit", amount: 100_000, currency: "THB", occurredOn: "2026-01-01" },
        { kind: "deposit", amount: 1000, currency: "USD", occurredOn: "2026-01-02" },
      ].map((row) => {
        const converted = convert(row.amount, row.currency as Currency)
        return converted ? { ...row, amount: converted.value } : null
      }).filter((row) => row !== null) as never,
      [],
    )
    expect(cash.deposits).toBeCloseTo(100_000 + 1000 * USD_THB, 2)
  })
})

// ---------------------------------------------------------------- regression: the US/USD path

describe("existing US/USD behaviour is unchanged", () => {
  it("produces the same numbers with no options at all", () => {
    const withoutOptions = buildPortfolio([{ ...NVDA, market: undefined }], quote)
    const withOptions = portfolio([NVDA], "USD")
    expect(withoutOptions.summary.marketValue).toBe(withOptions.summary.marketValue)
    expect(withoutOptions.holdings[0].weight).toBe(withOptions.holdings[0].weight)
    // A row written before phase 9 carries no market and is treated as US, as the column defaults.
    expect(withoutOptions.holdings[0]).toMatchObject({ market: "US", currency: "USD" })
  })

  it("prices holdings identically whether or not a converter is supplied", () => {
    const positions = computePositions([NVDA])
    const plain = priceHoldings(positions, quote)
    const converted = priceHoldings(positions, quote, {
      baseCurrency: "USD",
      convert: converterTo("USD", buildFxTable([rate()]), NOW),
    })
    expect(plain[0].baseMarketValue).toBe(converted[0].baseMarketValue)
  })
})
