/**
 * Symbol and market identity now live in `domain/market.ts`, beside the registry that gives them
 * meaning — they are business rules, not infrastructure. This module stays as the import path the
 * rest of the app already uses, so nothing had to be rewritten when they moved.
 */
export {
  MARKETS,
  isMarket,
  isValidSymbol,
  normalizeSymbol,
  parseMarket,
  parseSymbolKey,
  symbolKey,
  toMarket,
} from "@/domain/market"

export type { Market, MarketId } from "@/domain/market"
