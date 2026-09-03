import type { NewsProvider, RawArticle } from "./types"

/**
 * The provider for a deployment with no news vendor.
 *
 * **This is the default**, for the same reason `services/fundamentals` defaults to unavailable:
 * Stockly's configured market-data vendor supplies no news feed, and the two dishonest
 * alternatives are worse than admitting it.
 *
 * - An adapter returning `[]` makes "no provider" indistinguishable from "nothing happened today".
 * - A mock in production would put **invented headlines attributed to real publications** on
 *   screen. Fabricating a news story is categorically worse than fabricating a number: a number is
 *   wrong, a fake headline attributed to Reuters is a lie about what Reuters said.
 *
 * So this declares zero capabilities and returns nothing, and every news surface reads
 * `capabilities` to say "not configured" rather than "no news".
 */
export const unavailableNewsProvider: NewsProvider = {
  name: "unavailable",

  capabilities: {
    markets: [],
    bySymbol: false,
    byMarket: false,
    search: false,
    summaries: false,
  },

  // Empty rather than throwing: a missing provider degrades a section, never a page.
  async bySymbol(): Promise<RawArticle[]> {
    return []
  },
  async byMarket(): Promise<RawArticle[]> {
    return []
  },
  async search(): Promise<RawArticle[]> {
    return []
  },
}
