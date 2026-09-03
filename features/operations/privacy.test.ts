import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { projectPublicPortfolio, DEFAULT_SHARE_CONFIG, applyTemplate, SHARE_TEMPLATES } from "@/domain/sharing"
import { config, source } from "@/domain/sharing.test"
import type { ShareSource } from "@/domain/sharing"

/**
 * **A reconciliation is more private than the portfolio it reconciles.**
 *
 * A holdings list says what somebody owns. A reconciliation says what their *broker statement*
 * said, which broker it was, what their cash balance is in each currency, and which of their own
 * records they got wrong. An audit trail goes further still: it is the history of every correction
 * they have ever made.
 *
 * None of it has any business on a page a stranger can open, and there is no switch to turn it on —
 * `ShareSource` declares no field for any of it, so `projectPublicPortfolio` cannot carry one
 * because it is never handed one. These prove that by projection and by reading the source.
 */

const PRIVATE_MARKERS = [
  "Broker XYZ",
  "reconciliation",
  "QUANTITY_DIFFERS",
  "MISSING_IN_STOCKLY",
  "SPLIT_RATIO",
  "brokerQuantity",
  "stocklyBalance",
  "financial_audit",
  "correct_transaction",
  "wrong quantity",
  "CORRECTION",
]

function contaminated(): ShareSource {
  return {
    ...source(),
    // Every shape phase 19 introduces, attached to a source that is about to be projected.
    reconciliation: {
      sourceLabel: "Broker XYZ",
      status: "COMPLETED_WITH_WARNINGS",
      positions: [{ status: "QUANTITY_DIFFERS", brokerQuantity: 105, causes: ["SPLIT_RATIO"] }],
      cash: [{ currency: "USD", stocklyBalance: 1234.56, status: "MISSING_IN_STOCKLY" }],
    },
    audit: [{ operation: "UPDATE", reason: "wrong quantity", source: "CORRECTION" }],
    adjustments: [{ symbol: "AAPL", numerator: 2, denominator: 1 }],
    cashByCurrency: [{ currency: "THB", balance: 42000 }],
    holdings: source().holdings.map((holding) => ({
      ...holding,
      reconciliation: { status: "QUANTITY_DIFFERS", brokerQuantity: 105 },
    })),
  } as unknown as ShareSource
}

describe("no reconciliation reaches a shared page", () => {
  it("is absent under every preset", () => {
    for (const template of SHARE_TEMPLATES) {
      const serialised = JSON.stringify(
        projectPublicPortfolio(contaminated(), applyTemplate(config(), template)),
      )
      for (const marker of PRIVATE_MARKERS) {
        expect(serialised.includes(marker), `${marker} leaked under ${template}`).toBe(false)
      }
    }
  })

  it("is absent with every sharing switch on at once", () => {
    // The case that matters: a user who turned everything on still never turned this on, because
    // there is nothing to turn on.
    const everything = config(
      Object.fromEntries(
        Object.keys(DEFAULT_SHARE_CONFIG)
          .filter((key) => key.startsWith("show"))
          .map((key) => [key, true]),
      ),
    )
    const serialised = JSON.stringify(projectPublicPortfolio(contaminated(), everything))
    for (const marker of PRIVATE_MARKERS) {
      expect(serialised.includes(marker), marker).toBe(false)
    }
  })

  it("adds no reconciliation key to a published holding", () => {
    const everything = config({ showHoldings: true, showQuantity: true, showAbsoluteValues: true })
    const document = projectPublicPortfolio(contaminated(), everything)
    for (const position of document.sections.holdings?.positions ?? []) {
      expect("reconciliation" in position).toBe(false)
      expect("brokerQuantity" in position).toBe(false)
    }
  })

  /**
   * A per-currency balance is a finer disclosure than the translated total a user may have chosen
   * to publish: it says which markets they are actually funded in.
   */
  it("publishes no per-currency cash balance", () => {
    const everything = config({ showCash: true, showAbsoluteValues: true })
    const serialised = JSON.stringify(projectPublicPortfolio(contaminated(), everything))
    expect(serialised.includes("cashByCurrency")).toBe(false)
    expect(serialised.includes("42000")).toBe(false)
  })
})

describe("the sharing source declares no field for any of it", () => {
  const SHARING = readFileSync(join(process.cwd(), "domain", "sharing.ts"), "utf8")

  it("has no reconciliation, audit or adjustment field", () => {
    for (const field of ["reconciliation", "financialAudit", "shareAdjustment", "cashByCurrency", "brokerPosition"]) {
      expect(SHARING.includes(field), field).toBe(false)
    }
  })

  /**
   * The projection constructs its output field by field and never spreads an input. A spread is
   * how a field added to `ShareSource` in a year's time would publish itself.
   */
  it("still never spreads its input", () => {
    // The whole object, not a member of it: `[...source.risk.limitations]` copies an array of
    // strings and is fine, while `{ ...source }` publishes every field added from now on.
    expect(SHARING).not.toMatch(/\.\.\.source(?![.\w])/)
    expect(SHARING).not.toMatch(/\.\.\.input(?![.\w])/)
  })
})

describe("the operations layer cannot be reached by an anonymous visitor", () => {
  const MIGRATION = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260911000000_portfolio_operations.sql"),
    "utf8",
  )

  it("grants the anonymous role nothing", () => {
    expect(MIGRATION).not.toContain("to anon")
    expect(MIGRATION.toLowerCase()).not.toContain("using (true)")
  })

  it("scopes every policy it creates to auth.uid()", () => {
    const policies = MIGRATION.match(/create policy[\s\S]*?;/g) ?? []
    expect(policies.length).toBeGreaterThan(0)
    for (const policy of policies) {
      expect(policy, policy.slice(0, 60)).toContain("auth.uid()")
    }
  })
})
