import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildPortfolio, replayPortfolio } from "./holdings"
import { computeCash } from "./cash"
import {
  applyTemplate,
  DEFAULT_SHARE_CONFIG,
  linkState,
  normalizeSlug,
  projectPublicPortfolio,
  SHARE_TEMPLATES,
} from "./sharing"
import { config, source } from "./sharing.test"
import type { DomainTransaction } from "./types"

/**
 * The phase 13 invariants.
 *
 * The one that matters most: **sharing cannot move a number.** A share configuration is a set of
 * switches about what a page may say; a snapshot is a rendering; a link is a capability. None of
 * them is an input to the calculation engine, and the dependency runs one way only.
 *
 * Proven twice, as elsewhere in this codebase: behaviourally, by running every sharing operation
 * against a real portfolio and comparing the financial state byte for byte, and structurally, by
 * reading `sharing.ts` for anything that could reach a database, a network or a framework.
 */

const tx = (
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  price: number,
  fee = 0,
  tradeDate = "2026-01-02",
  sequence = 0,
): DomainTransaction => ({ symbol, side, quantity, price, fee, tradeDate, sequence })

const TRANSACTIONS = [
  tx("NVDA", "buy", 10, 170, 1.5, "2026-01-02", 1),
  tx("AAPL", "buy", 20, 200, 1, "2026-02-02", 2),
  tx("NVDA", "sell", 4, 200, 1.5, "2026-03-02", 3),
]
const CASH = [
  { kind: "deposit" as const, amount: 10_000, currency: "USD" as const, occurredOn: "2026-01-01" },
]
const quote = (symbol: string) => ({ NVDA: { price: 180 }, AAPL: { price: 210 } })[symbol]

/** Holdings, cost basis, realised and unrealised P&L, and cash — the whole financial state. */
function financialState() {
  const { holdings, summary } = buildPortfolio(TRANSACTIONS, quote)
  const { trades } = replayPortfolio(TRANSACTIONS)
  const cash = computeCash(TRANSACTIONS, CASH, [])
  return JSON.stringify({ holdings, summary, trades, cash })
}

/** Every sharing operation that is pure, run once. */
function runEverySharingOperation() {
  for (const template of SHARE_TEMPLATES) {
    const settings = applyTemplate(config({ visibility: "PUBLIC", slug: "mine" }), template)
    projectPublicPortfolio(source(), settings)
  }
  projectPublicPortfolio(source(), DEFAULT_SHARE_CONFIG)
  normalizeSlug("My Portfolio")
  linkState({ expiresAt: null, revokedAt: null }, new Date())
}

describe("sharing cannot change a financial figure", () => {
  it("leaves holdings, cost basis, P&L and cash byte-identical", () => {
    const before = financialState()
    runEverySharingOperation()
    expect(financialState()).toBe(before)
  })

  it("produces the same figures whatever the sharing configuration is", () => {
    // The switches decide what is *said*, never what is *computed*. A portfolio that reported a
    // different return once it was shared would mean the projection had become an input.
    const before = financialState()
    for (const template of SHARE_TEMPLATES) {
      projectPublicPortfolio(source(), applyTemplate(config(), template))
      expect(financialState()).toBe(before)
    }
  })

  it("re-projects identically after every other projection has run", () => {
    const settings = config({ showOverview: true, showHoldings: true, showAbsoluteValues: true })
    const first = JSON.stringify(projectPublicPortfolio(source(), settings))
    runEverySharingOperation()
    expect(JSON.stringify(projectPublicPortfolio(source(), settings))).toBe(first)
  })
})

describe("the sharing engine cannot reach anything", () => {
  const FILE = join(process.cwd(), "domain", "sharing.ts")
  const contents = readFileSync(FILE, "utf8")

  const FORBIDDEN = [
    "@/lib/supabase",
    "supabase",
    "server-only",
    "next/",
    "revalidatePath",
    "fetch(",
    "@/services/",
    "@/features/",
    "node:crypto",
    "process.env",
  ]

  for (const needle of FORBIDDEN) {
    it(`never mentions ${needle}`, () => {
      expect(contents.includes(needle)).toBe(false)
    })
  }

  it("imports nothing outside domain/", () => {
    const imports = [...contents.matchAll(/from "([^"]+)"/g)].map((match) => match[1])
    for (const specifier of imports) {
      expect(specifier.startsWith("./"), `unexpected import ${specifier}`).toBe(true)
    }
  })

  it("does not generate a token, because a secret needs a CSPRNG and this file is pure", () => {
    // Token generation lives in lib/share-token.ts, where `node:crypto` is available. A "random"
    // token from Math.random in a pure module would be the worst possible version of this feature.
    expect(contents.includes("Math.random")).toBe(false)
  })
})

describe("the whole domain still refuses to import the sharing layer", () => {
  /**
   * The dependency runs one way. A calculation module that read a share configuration could
   * produce a different number for a shared portfolio than for a private one, which is the exact
   * failure this codebase's intelligence boundary already forbids for journals and theses.
   */
  const DOMAIN = join(process.cwd(), "domain")
  const CALCULATION_MODULES = readdirSync(DOMAIN)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "sharing.ts")

  for (const name of CALCULATION_MODULES) {
    it(`${name} does not import sharing`, () => {
      const contents = readFileSync(join(DOMAIN, name), "utf8")
      expect(contents.includes('from "./sharing"')).toBe(false)
      expect(contents.includes('from "@/domain/sharing"')).toBe(false)
    })
  }
})
