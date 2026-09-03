import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { buildPortfolio, replayPortfolio } from "./holdings"
import { computeCash } from "./cash"
import {
  applyView,
  DEFAULT_VIEW_CONFIG,
  dismissInsight,
  moveWidget,
  recordRecent,
  reorderWidgets,
  resolveLayout,
  resolveMetrics,
  toggleMetric,
  togglePin,
  toggleWidget,
  METRICS,
  type ViewRow,
} from "./personalization"
import type { DomainTransaction } from "./types"

/**
 * The phase 15 boundary.
 *
 * **Personalization decides what is displayed. It can never decide what is calculated.**
 *
 * The same statement phase 10 made for journals and phase 13 made for sharing, and it is worth
 * re-proving here rather than assuming, because personalization is the layer most likely to be
 * tempted across the line: a "favourite metric" is one refactor away from being a stored figure,
 * and a "saved view" is one refactor away from being a filtered portfolio somebody trusts.
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

function financialState(): string {
  const { holdings, summary } = buildPortfolio(TRANSACTIONS, quote)
  const { trades, positions } = replayPortfolio(TRANSACTIONS)
  const cash = computeCash(TRANSACTIONS, CASH, [])
  return JSON.stringify({ holdings, summary, trades, positions, cash })
}

const ROWS: ViewRow[] = [
  { symbol: "NVDA", market: "US", quantity: 6, marketValue: 1_080, weight: 20, unrealizedPnl: 60, returnPct: 5.9, sector: "Technology", tags: ["Growth"] },
  { symbol: "AAPL", market: "US", quantity: 20, marketValue: 4_200, weight: 80, unrealizedPnl: 200, returnPct: 5, sector: "Technology", tags: [] },
]

/** Every personalization operation the application offers, once each. */
function everyPersonalizationOperation(): void {
  let layout = resolveLayout(null)
  layout = toggleWidget(layout, "movers", false)
  layout = moveWidget(layout, "allocation", "up")
  layout = reorderWidgets(layout, ["watchlist", "summary"])
  resolveLayout(layout)

  let metrics = resolveMetrics(null)
  for (const metric of METRICS) metrics = toggleMetric(metrics, metric).metrics

  applyView(ROWS, DEFAULT_VIEW_CONFIG)
  applyView(ROWS, { ...DEFAULT_VIEW_CONFIG, groupBy: "tag", sortDirection: "asc" })
  applyView(ROWS, {
    ...DEFAULT_VIEW_CONFIG,
    filters: [{ field: "weight", operator: "gt", value: 50 }],
  })

  togglePin([], { kind: "stock", ref: "US:NVDA", label: "NVDA" })
  recordRecent([], { kind: "stock", ref: "US:AAPL", label: "AAPL" })
  dismissInsight([], "CONCENTRATION_HIGH")
}

describe("personalization cannot change a financial figure", () => {
  it("leaves holdings, cost basis, P&L and cash byte-identical", () => {
    const before = financialState()
    everyPersonalizationOperation()
    expect(financialState()).toBe(before)
  })

  it("is stable when every operation runs repeatedly", () => {
    const before = financialState()
    for (let i = 0; i < 5; i += 1) everyPersonalizationOperation()
    expect(financialState()).toBe(before)
  })

  it("a saved view never alters the rows it filters and sorts", () => {
    // The specific temptation this guards: a view that "normalises" a weight or fills a null while
    // sorting would silently produce a different number than the table beside it.
    const before = JSON.stringify(ROWS)
    applyView(ROWS, { ...DEFAULT_VIEW_CONFIG, groupBy: "sector" })
    applyView(ROWS, { ...DEFAULT_VIEW_CONFIG, sortBy: "weight", sortDirection: "asc" })
    expect(JSON.stringify(ROWS)).toBe(before)
  })

  it("a view returns the same rows it was given, not copies with adjusted figures", () => {
    const { groups } = applyView(ROWS, DEFAULT_VIEW_CONFIG)
    for (const row of groups[0].rows) {
      const original = ROWS.find((r) => r.symbol === row.symbol)
      expect(row.marketValue).toBe(original?.marketValue)
      expect(row.weight).toBe(original?.weight)
      expect(row.unrealizedPnl).toBe(original?.unrealizedPnl)
    }
  })
})

describe("the personalization module cannot reach anything", () => {
  const FILE = join(process.cwd(), "domain", "personalization.ts")
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
    "localStorage",
    "window.",
    "process.env",
  ]

  for (const needle of FORBIDDEN) {
    it(`never mentions ${needle}`, () => {
      expect(contents.includes(needle)).toBe(false)
    })
  }

  it("imports nothing at all", () => {
    // It needs no other module: a preference is an id, a position and a boolean. If this ever needs
    // an import, the question to ask is whether a figure is creeping in.
    expect(contents.includes('from "')).toBe(false)
  })

  it("contains no arithmetic on money", () => {
    // A crude check with a real purpose: the moment a `*` or a `/` appears beside a price or a
    // quantity in this file, personalization has started computing something.
    for (const banned of ["marketValue *", "marketValue /", "* price", "quantity *"]) {
      expect(contents.includes(banned), banned).toBe(false)
    }
  })
})

describe("no calculation module imports personalization", () => {
  /**
   * The dependency runs one way. A calculation that read a preference could produce a different
   * number for a user who had chosen a different dashboard, which is the precise failure the
   * intelligence and sharing boundaries already forbid.
   */
  const DOMAIN = join(process.cwd(), "domain")
  const MODULES = readdirSync(DOMAIN).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && name !== "personalization.ts",
  )

  for (const name of MODULES) {
    it(`${name} does not import personalization`, () => {
      const contents = readFileSync(join(DOMAIN, name), "utf8")
      expect(contents.includes('from "./personalization"')).toBe(false)
      expect(contents.includes('from "@/domain/personalization"')).toBe(false)
    })
  }
})
