import { describe, expect, it } from "vitest"
import {
  applyTemplate,
  DEFAULT_SHARE_CONFIG,
  expiryFor,
  isValidSlug,
  linkState,
  MAX_PUBLIC_HOLDINGS,
  normalizeSlug,
  projectPublicPortfolio,
  RESERVED_SLUGS,
  SHARE_TEMPLATES,
  SHARE_VISIBILITIES,
  shouldNoIndex,
  SNAPSHOT_VERSION,
  thinSeries,
  type ShareConfig,
  type ShareSource,
} from "./sharing"

/** A source with something in every field, so a projection that leaks has something to leak. */
export function source(overrides: Partial<ShareSource> = {}): ShareSource {
  return {
    portfolioName: "Growth",
    baseCurrency: "USD",
    calculatedAt: "2026-09-02T10:00:00.000Z",
    freshness: {
      marketDataStale: false,
      staleMarkets: [],
      missingFxPairs: [],
      untranslatedCount: 0,
    },
    overview: {
      totalValue: 125_430,
      investedValue: 100_000,
      cashValue: 5_430,
      unrealizedPnl: 20_000,
      realizedPnl: 3_100,
      returnPct: 20,
      todayReturnPct: 0.8,
      holdingsCount: 3,
    },
    holdings: [
      {
        symbol: "NVDA",
        market: "US",
        currency: "USD",
        quantity: 150,
        baseMarketValue: 27_000,
        weightPct: 21.5,
        unrealizedPnl: 4_000,
        returnPct: 17.4,
        stale: false,
      },
      {
        symbol: "PTT",
        market: "SET",
        currency: "THB",
        quantity: 1_000,
        // No rate reached the base currency. Null, never 0.
        baseMarketValue: null,
        weightPct: null,
        unrealizedPnl: 900,
        returnPct: 3.2,
        stale: true,
      },
    ],
    allocation: [{ key: "NVDA", label: "NVDA", weightPct: 21.5 }],
    markets: [{ key: "US", label: "US", weightPct: 80 }],
    currencies: [{ key: "USD", label: "USD", weightPct: 80 }],
    performance: {
      timeWeightedReturnPct: 14.2,
      moneyWeightedReturnPct: 15.9,
      range: "1Y",
      series: [
        { date: "2026-01-01", index: 100 },
        { date: "2026-06-01", index: 112 },
      ],
    },
    benchmark: {
      name: "S&P 500",
      portfolioReturnPct: 14.2,
      benchmarkReturnPct: 11.0,
      differencePct: 3.2,
      unavailableReason: null,
    },
    risk: {
      volatilityPct: 18.4,
      maxDrawdownPct: 12.1,
      sharpe: 0.9,
      beta: 1.1,
      topWeightPct: 21.5,
      observations: 250,
      limitations: [],
    },
    income: { trailingTwelveMonths: 1_240, yieldOnValuePct: 1.0, yieldOnCostPct: 1.24 },
    goals: [{ label: "Portfolio value", progressPct: 62, targetLabel: "200000 USD" }],
    insights: [{ code: "CONCENTRATION_HIGH", title: "One position is 21.5%", detail: "NVDA is 21.5% of the portfolio." }],
    ...overrides,
  }
}

export function config(overrides: Partial<ShareConfig> = {}): ShareConfig {
  return { ...DEFAULT_SHARE_CONFIG, ...overrides }
}

describe("the default is private", () => {
  it("shares nothing at all", () => {
    expect(DEFAULT_SHARE_CONFIG.visibility).toBe("PRIVATE")
    for (const [key, value] of Object.entries(DEFAULT_SHARE_CONFIG)) {
      if (key.startsWith("show") || key === "allowSearchIndexing") expect(value).toBe(false)
    }
  })

  it("projects an empty document, not an empty-looking one", () => {
    // No section keys at all — not sections full of nulls. A visitor cannot tell a withheld figure
    // from one that does not exist, which is the point.
    const result = projectPublicPortfolio(source(), DEFAULT_SHARE_CONFIG)
    expect(result.sections).toEqual({})
  })

  it("still names the portfolio and its currency, because a page needs a heading", () => {
    const result = projectPublicPortfolio(source(), DEFAULT_SHARE_CONFIG)
    expect(result.displayName).toBe("Growth")
    expect(result.baseCurrency).toBe("USD")
    expect(result.version).toBe(SNAPSHOT_VERSION)
  })
})

describe("presets", () => {
  it("never turn on realised P&L or cash, even the one called everything", () => {
    // The two figures a reader can least justify needing, and a preset called "everything" is
    // exactly where an unnoticed default would do its damage.
    const full = applyTemplate(config(), "FULL")
    expect(full.showRealizedPnl).toBe(false)
    expect(full.showCash).toBe(false)
  })

  it("never turn on search indexing", () => {
    for (const template of SHARE_TEMPLATES) {
      expect(applyTemplate(config({ allowSearchIndexing: true }), template).allowSearchIndexing).toBe(false)
    }
  })

  it("never expose goals, which are personal targets rather than portfolio facts", () => {
    for (const template of SHARE_TEMPLATES) {
      expect(applyTemplate(config(), template).showGoals).toBe(false)
    }
  })

  it("start from all-off rather than from what was already on", () => {
    const everythingOn = config({ showCash: true, showRealizedPnl: true, showQuantity: true })
    expect(applyTemplate(everythingOn, "PERFORMANCE").showCash).toBe(false)
    expect(applyTemplate(everythingOn, "PERFORMANCE").showQuantity).toBe(false)
  })

  it("keep the address and identity, which are not part of a preset", () => {
    const current = config({ visibility: "PUBLIC", slug: "mine", displayName: "Mine" })
    const applied = applyTemplate(current, "OVERVIEW")
    expect(applied.slug).toBe("mine")
    expect(applied.visibility).toBe("PUBLIC")
    expect(applied.displayName).toBe("Mine")
  })

  it("the private preset shares nothing", () => {
    expect(applyTemplate(config(), "PRIVATE")).toEqual({
      ...DEFAULT_SHARE_CONFIG,
      visibility: config().visibility,
      slug: null,
      displayName: null,
      description: null,
      ownerDisplayName: null,
    })
  })
})

describe("slugs", () => {
  it("normalizes what a person types", () => {
    expect(normalizeSlug("My Growth Portfolio")).toBe("my-growth-portfolio")
    expect(normalizeSlug("  Hello--World  ")).toBe("hello-world")
    expect(normalizeSlug("Café Portfolio")).toBe("cafe-portfolio")
  })

  it("refuses what cannot be a segment", () => {
    expect(normalizeSlug("ab")).toBeNull()
    expect(normalizeSlug("!!!")).toBeNull()
    // A Thai name reduces to nothing rather than to a slug its owner cannot read.
    expect(normalizeSlug("พอร์ตของฉัน")).toBeNull()
  })

  it("refuses routes the application owns", () => {
    for (const reserved of RESERVED_SLUGS) {
      expect(normalizeSlug(reserved)).toBeNull()
      expect(isValidSlug(reserved)).toBe(false)
    }
  })

  it("rejects shapes the database constraint would also reject", () => {
    expect(isValidSlug("-leading")).toBe(false)
    expect(isValidSlug("trailing-")).toBe(false)
    expect(isValidSlug("double--hyphen")).toBe(false)
    expect(isValidSlug("Upper")).toBe(false)
    expect(isValidSlug("a".repeat(49))).toBe(false)
    expect(isValidSlug("good-one-2")).toBe(true)
  })
})

describe("share links", () => {
  const now = new Date("2026-09-02T12:00:00.000Z")

  it("is valid when it has neither expired nor been revoked", () => {
    expect(linkState({ expiresAt: null, revokedAt: null }, now)).toBe("VALID")
    expect(linkState({ expiresAt: "2026-09-03T00:00:00.000Z", revokedAt: null }, now)).toBe("VALID")
  })

  it("expires at the moment it says, not a second later", () => {
    expect(linkState({ expiresAt: "2026-09-02T12:00:00.000Z", revokedAt: null }, now)).toBe("EXPIRED")
  })

  it("reports revocation ahead of expiry, because the owner made a decision", () => {
    const both = { expiresAt: "2026-01-01T00:00:00.000Z", revokedAt: "2026-02-01T00:00:00.000Z" }
    expect(linkState(both, now)).toBe("REVOKED")
  })

  it("computes the offered expiries from the current time", () => {
    expect(expiryFor("1D", now)).toBe("2026-09-03T12:00:00.000Z")
    expect(expiryFor("7D", now)).toBe("2026-09-09T12:00:00.000Z")
    expect(expiryFor("30D", now)).toBe("2026-10-02T12:00:00.000Z")
    expect(expiryFor("NEVER", now)).toBeNull()
  })
})

describe("indexing", () => {
  it("is refused for everything except a public portfolio that asked for it", () => {
    expect(shouldNoIndex("PUBLIC", true)).toBe(false)
    expect(shouldNoIndex("PUBLIC", false)).toBe(true)
    for (const visibility of SHARE_VISIBILITIES.filter((v) => v !== "PUBLIC")) {
      expect(shouldNoIndex(visibility, true)).toBe(true)
    }
  })
})

describe("bounding the document", () => {
  it("thins a long series while keeping its ends", () => {
    const points = Array.from({ length: 5_000 }, (_, i) => ({ date: String(i), index: i }))
    const thinned = thinSeries(points, 400)
    expect(thinned).toHaveLength(400)
    expect(thinned[0]).toEqual(points[0])
    expect(thinned.at(-1)).toEqual(points.at(-1))
  })

  it("leaves a short series alone", () => {
    const points = [{ a: 1 }, { a: 2 }]
    expect(thinSeries(points, 400)).toEqual(points)
  })

  it("caps how many positions a page lists and says how many it left out", () => {
    const many = Array.from({ length: MAX_PUBLIC_HOLDINGS + 7 }, (_, i) => ({
      ...source().holdings[0],
      symbol: `S${i}`,
    }))
    const result = projectPublicPortfolio(source({ holdings: many }), config({ showHoldings: true }))
    expect(result.sections.holdings?.positions).toHaveLength(MAX_PUBLIC_HOLDINGS)
    expect(result.sections.holdings?.hiddenCount).toBe(7)
  })
})

describe("null semantics survive the projection", () => {
  it("keeps an untranslated holding's weight null rather than calling it 0%", () => {
    const result = projectPublicPortfolio(source(), config({ showHoldings: true }))
    const ptt = result.sections.holdings?.positions.find((p) => p.symbol === "PTT")
    expect(ptt?.weightPct).toBeNull()
  })

  it("keeps a missing market value null when amounts are shared", () => {
    const result = projectPublicPortfolio(
      source(),
      config({ showHoldings: true, showAbsoluteValues: true }),
    )
    const ptt = result.sections.holdings?.positions.find((p) => p.symbol === "PTT")
    expect(ptt?.marketValue).toBeNull()
  })

  it("keeps an uncomputable risk statistic null rather than zero", () => {
    const thin = source({
      risk: {
        volatilityPct: null,
        maxDrawdownPct: null,
        sharpe: null,
        beta: null,
        topWeightPct: null,
        observations: 4,
        limitations: ["Not enough history for volatility."],
      },
    })
    const result = projectPublicPortfolio(thin, config({ showRisk: true }))
    expect(result.sections.risk?.volatilityPct).toBeNull()
    expect(result.sections.risk?.sharpe).toBeNull()
    expect(result.sections.risk?.limitations).toEqual(["Not enough history for volatility."])
  })

  it("carries the freshness of the figures it was built from", () => {
    const stale = source({
      freshness: {
        marketDataStale: true,
        staleMarkets: ["SET"],
        missingFxPairs: ["THB/USD"],
        untranslatedCount: 1,
      },
    })
    const result = projectPublicPortfolio(stale, config({ showOverview: true }))
    expect(result.freshness.marketDataStale).toBe(true)
    expect(result.freshness.untranslatedCount).toBe(1)
  })
})

describe("the projection is a pure function of its inputs", () => {
  it("never mutates the source", () => {
    const input = source()
    const before = JSON.stringify(input)
    projectPublicPortfolio(input, config({ showHoldings: true, showAllocation: true, showRisk: true }))
    expect(JSON.stringify(input)).toBe(before)
  })

  it("returns the same document for the same inputs", () => {
    const settings = config({ showOverview: true, showHoldings: true, showAbsoluteValues: true })
    const a = projectPublicPortfolio(source(), settings)
    const b = projectPublicPortfolio(source(), settings)
    expect(a).toEqual(b)
  })

  it("does not alias the source's arrays into the document", () => {
    const input = source()
    const result = projectPublicPortfolio(input, config({ showRisk: true }))
    // A shared copy, not the source's own array: a caller mutating the document must not reach back
    // into the bundle the dashboard is still rendering from.
    expect(result.sections.risk?.limitations).not.toBe(input.risk.limitations)
    expect(result.freshness.staleMarkets).not.toBe(input.freshness.staleMarkets)
  })
})
