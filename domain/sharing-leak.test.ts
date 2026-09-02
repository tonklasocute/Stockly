import { describe, expect, it } from "vitest"
import {
  DEFAULT_SHARE_CONFIG,
  projectPublicPortfolio,
  SHARE_TEMPLATES,
  applyTemplate,
  type ShareConfig,
  type PublicPortfolio,
} from "./sharing"
import { config, source } from "./sharing.test"

/**
 * What a visitor must never receive.
 *
 * This is the test the whole feature is arranged around. It does not read the projector's code and
 * it does not trust the type system — it walks the **actual document** that would be written to
 * `published_shares`, across every combination of settings, looking for anything that should not be
 * in it.
 *
 * Two kinds of check, and both are needed:
 *
 * - **By key.** A field named `email`, `userId`, `note` or `token` is a leak whatever it contains,
 *   because its presence means the projector copied something wholesale.
 * - **By value.** Every private string in the fixture is searched for in the serialised document.
 *   A journal entry renamed to a harmless key is still a journal entry.
 *
 * Frontend hiding is not a control. Nothing here renders anything.
 */

/** Keys that must never appear anywhere in a published document, at any depth. */
const FORBIDDEN_KEYS = [
  "userId", "user_id", "email", "password", "token", "tokenHash", "token_hash",
  "session", "accessToken", "refreshToken", "apiKey", "portfolioId", "portfolio_id",
  "id", "note", "notes", "journal", "thesis", "theses", "transactions", "transaction",
  "broker", "account", "accountNumber", "reference", "importFingerprint", "import_fingerprint",
  "simulations", "scenario", "costBasis", "averageCost", "trades",
]

/**
 * Values planted in the fixture that stand for private content. If any appears in the serialised
 * document, something copied a field it was never handed deliberately.
 */
const PRIVATE_MARKERS = [
  "tkliketoeatmhookorb@gmail.com",
  "11111111-1111-4111-8111-111111111111",
  "I bought this because the datacentre story is intact",
  "Sell if margins compress two quarters running",
  "Retire at 55",
  "SCB-8891-0022",
]

/** Every private thing that exists near a portfolio, planted where a careless projector could find it. */
function contaminatedSource() {
  const base = source()
  // Deliberately widened beyond ShareSource: this is what a real bundle looks like, and the point
  // is that passing extra fields cannot cause them to be projected.
  return {
    ...base,
    userId: "11111111-1111-4111-8111-111111111111",
    email: "tkliketoeatmhookorb@gmail.com",
    portfolioId: "11111111-1111-4111-8111-111111111111",
    journal: [{ note: "I bought this because the datacentre story is intact" }],
    theses: [{ note: "Sell if margins compress two quarters running" }],
    transactions: [{ symbol: "NVDA", reference: "SCB-8891-0022", price: 170 }],
    /*
     * A goal's label is its *type* — `toShareSource` reads GOAL_DEFINITIONS, never the row's free
     * text. The private sentence is planted in the note beside it, which is where it lives in the
     * database, so this asserts what the projector actually has to get right: it copies the fields
     * it names and nothing adjacent to them.
     */
    goals: [
      {
        label: "Portfolio value",
        progressPct: 62,
        targetLabel: "200000 USD",
        note: "Retire at 55",
      },
    ],
  } as unknown as ReturnType<typeof source>
}

function walk(value: unknown, visit: (key: string, value: unknown) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
    return
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      visit(key, child)
      walk(child, visit)
    }
  }
}

function keysIn(document: PublicPortfolio): string[] {
  const keys: string[] = []
  walk(document, (key) => keys.push(key))
  return keys
}

/** Every combination worth testing: the presets, plus each individual switch on its own. */
function everyConfiguration(): ShareConfig[] {
  const singles = Object.keys(DEFAULT_SHARE_CONFIG)
    .filter((key) => key.startsWith("show"))
    .map((key) => config({ [key]: true } as Partial<ShareConfig>))

  const templates = SHARE_TEMPLATES.map((template) => applyTemplate(config(), template))

  return [
    DEFAULT_SHARE_CONFIG,
    ...singles,
    ...templates,
    // Everything on at once, including the two no preset turns on.
    config(
      Object.fromEntries(
        Object.keys(DEFAULT_SHARE_CONFIG)
          .filter((key) => key.startsWith("show"))
          .map((key) => [key, true]),
      ) as Partial<ShareConfig>,
    ),
  ]
}

describe("a published document never contains private data", () => {
  it("has no forbidden key, under any configuration", () => {
    for (const settings of everyConfiguration()) {
      const document = projectPublicPortfolio(contaminatedSource(), settings)
      const found = keysIn(document).filter((key) => FORBIDDEN_KEYS.includes(key))
      expect(found, `leaked keys for ${JSON.stringify(settings)}`).toEqual([])
    }
  })

  it("contains none of the private strings planted around it", () => {
    for (const settings of everyConfiguration()) {
      const serialised = JSON.stringify(projectPublicPortfolio(contaminatedSource(), settings))
      for (const marker of PRIVATE_MARKERS) {
        expect(serialised.includes(marker), `leaked ${marker}`).toBe(false)
      }
    }
  })

  it("drops a goal's note while keeping the progress beside it", () => {
    // A goal's name in Stockly is its *type*; the free text is a note, and a note is the owner's own
    // words about their money. `features/sharing/source.test.ts` covers the other half — that the
    // note never becomes the label on the way in.
    const document = projectPublicPortfolio(contaminatedSource(), config({ showGoals: true }))
    const serialised = JSON.stringify(document.sections.goals)
    expect(serialised.includes("Retire at 55")).toBe(false)
    expect(document.sections.goals?.[0].progressPct).toBe(62)
  })

  it("survives a source carrying fields the projector has never heard of", () => {
    const rogue = { ...source(), secretPlan: "buy a house", apiKey: "sk-live-abc" } as unknown as ReturnType<
      typeof source
    >
    const document = projectPublicPortfolio(rogue, config({ showOverview: true, showHoldings: true }))
    expect(JSON.stringify(document).includes("sk-live-abc")).toBe(false)
    expect(JSON.stringify(document).includes("buy a house")).toBe(false)
  })
})

describe("each switch releases exactly what it names", () => {
  const both = (extra: Partial<ShareConfig>) => config({ showAbsoluteValues: true, ...extra })

  it("withholds every amount until amounts are turned on", () => {
    const document = projectPublicPortfolio(source(), config({ showOverview: true }))
    expect(document.sections.overview?.totalValue).toBeUndefined()
    expect(document.sections.overview?.investedValue).toBeUndefined()
    // The percentage return is not an amount and is what "overview" means.
    expect(document.sections.overview?.returnPct).toBe(20)
  })

  it("releases amounts when they are turned on", () => {
    const document = projectPublicPortfolio(source(), both({ showOverview: true }))
    expect(document.sections.overview?.totalValue).toBe(125_430)
  })

  it("keeps cash withheld even when amounts are on", () => {
    // Two switches, both required. Sharing a portfolio's size is not consent to share the bank
    // balance sitting inside it.
    const document = projectPublicPortfolio(source(), both({ showOverview: true }))
    expect(document.sections.overview?.cashValue).toBeUndefined()

    const withCash = projectPublicPortfolio(source(), both({ showOverview: true, showCash: true }))
    expect(withCash.sections.overview?.cashValue).toBe(5_430)
  })

  it("keeps cash withheld when it is on but amounts are not", () => {
    const document = projectPublicPortfolio(source(), config({ showOverview: true, showCash: true }))
    expect(document.sections.overview?.cashValue).toBeUndefined()
  })

  it("keeps realised P&L withheld independently of unrealised", () => {
    const document = projectPublicPortfolio(
      source(),
      both({ showOverview: true, showUnrealizedPnl: true }),
    )
    expect(document.sections.overview?.unrealizedPnl).toBe(20_000)
    expect(document.sections.overview?.realizedPnl).toBeUndefined()
  })

  it("withholds quantities until quantities are turned on", () => {
    const hidden = projectPublicPortfolio(source(), config({ showHoldings: true }))
    expect(hidden.sections.holdings?.positions[0].quantity).toBeUndefined()
    // Allocation only: the symbol and its weight, nothing else.
    expect(hidden.sections.holdings?.positions[0].weightPct).toBe(21.5)

    const shown = projectPublicPortfolio(source(), config({ showHoldings: true, showQuantity: true }))
    expect(shown.sections.holdings?.positions[0].quantity).toBe(150)
  })

  it("withholds a position's value even when its quantity is shown", () => {
    const document = projectPublicPortfolio(source(), config({ showHoldings: true, showQuantity: true }))
    expect(document.sections.holdings?.positions[0].marketValue).toBeUndefined()
  })

  it("withholds a position's P&L until unrealised P&L is turned on", () => {
    const document = projectPublicPortfolio(source(), config({ showHoldings: true }))
    expect(document.sections.holdings?.positions[0].returnPct).toBeUndefined()
    expect(document.sections.holdings?.positions[0].unrealizedPnl).toBeUndefined()
  })

  it("shares a dividend yield without sharing the income that produced it", () => {
    const document = projectPublicPortfolio(source(), config({ showDividends: true }))
    expect(document.sections.income?.yieldOnValuePct).toBe(1.0)
    expect(document.sections.income?.trailingTwelveMonths).toBeUndefined()
  })

  it("shares goal progress without the target until amounts are on", () => {
    const document = projectPublicPortfolio(source(), config({ showGoals: true }))
    expect(document.sections.goals?.[0].progressPct).toBe(62)
    expect(document.sections.goals?.[0].targetLabel).toBeUndefined()
  })

  it("omits a section entirely rather than nulling it", () => {
    const document = projectPublicPortfolio(source(), config({ showOverview: true }))
    // `null` in Stockly means "not computable" and renders as N/A. "Withheld" is a different
    // statement and must not borrow that representation.
    expect("holdings" in document.sections).toBe(false)
    expect("risk" in document.sections).toBe(false)
    expect("performance" in document.sections).toBe(false)
  })

  it("omits a benchmark the engine could not produce, whatever the switch says", () => {
    const document = projectPublicPortfolio(source({ benchmark: null }), config({ showBenchmark: true }))
    expect("benchmark" in document.sections).toBe(false)
  })
})

describe("the performance series carries no portfolio size", () => {
  it("is an index, so it cannot be read back into an account balance", () => {
    const document = projectPublicPortfolio(source(), config({ showPerformance: true }))
    expect(document.sections.performance?.series[0].index).toBe(100)
    const serialised = JSON.stringify(document.sections.performance)
    expect(serialised.includes("125430")).toBe(false)
  })
})
