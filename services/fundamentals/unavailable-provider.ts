import type { CorporateEvent } from "@/domain/corporate-events"
import type { FinancialStatement } from "@/domain/fundamentals"
import type { DividendPayment, FundamentalDataProvider } from "./types"

/**
 * The provider for a deployment that has no fundamentals vendor.
 *
 * **This is the default**, and it exists because of a fact worth writing down rather than
 * discovering: Stockly's configured market-data vendor, Twelve Data, does not include financial
 * statements, corporate events or an earnings calendar on the free tier this application is built
 * against. Phase 17 therefore ships the *architecture* for fundamentals with no vendor behind it.
 *
 * The alternative designs were both worse:
 *
 * - **Return empty arrays from a "Twelve Data" adapter.** Then the UI cannot distinguish "this
 *   company has no financials" from "we have no provider", and every instrument looks like a
 *   company that reports nothing.
 * - **Fall back to the mock in production.** Synthetic revenue rendered as a company's accounts is
 *   the single worst thing this codebase could do, and no amount of labelling makes it safe.
 *
 * So this one answers honestly: it declares zero capabilities, and every method returns nothing.
 * The UI reads `capabilities` and says "fundamental data is not configured for this deployment",
 * which is true, actionable, and impossible to mistake for a fact about the company.
 */
export const unavailableFundamentalProvider: FundamentalDataProvider = {
  name: "unavailable",

  capabilities: {
    markets: [],
    periods: [],
    statements: false,
    corporateEvents: false,
    earningsCalendar: false,
    dividendHistory: false,
    forwardEstimates: false,
  },

  // Empty rather than throwing: a missing provider must degrade a section, never take a page down.
  async getFinancialStatements(): Promise<FinancialStatement[]> {
    return []
  },
  async getSharesOutstanding(): Promise<number | null> {
    return null
  },
  async getCorporateEvents(): Promise<CorporateEvent[]> {
    return []
  },
  async getDividendHistory(): Promise<DividendPayment[]> {
    return []
  },
}
