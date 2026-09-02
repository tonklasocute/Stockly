import { QUANTITY_SCALE, MONEY_SCALE, quantize } from "../money"
import { symbolKey, type MarketId } from "../market"
import type { TransactionSide } from "../types"

/**
 * The idempotency key that makes an import safe to run twice.
 *
 * **It is a canonical string, not a hash.** A hash collision here would mean a real transaction
 * silently skipped as a duplicate — money quietly missing from a portfolio — and the only thing
 * hashing would buy is a shorter index key. A hundred characters in a btree is not a problem worth
 * that risk, and a readable fingerprint can be inspected in the database when someone asks why a
 * row was skipped.
 *
 * Two shapes, and the choice between them is the important part:
 *
 * **With a broker reference** the fingerprint is the portfolio and the reference, and nothing else.
 * A broker's own trade id is a better identity than the values, and using it means a *corrected*
 * row — same trade, fixed price — re-imports as a duplicate rather than as a second transaction.
 * The correction then surfaces through reconciliation as a conflict for the user to decide about,
 * which is the honest outcome: Stockly does not silently overwrite a financial record.
 *
 * **Without one** it is the values that define the trade. Two genuinely identical trades on the
 * same day — a real thing, an order filled in two clips — collide, and the second is reported as a
 * duplicate. That is the safe direction to be wrong in: the user sees "1 duplicate" in the preview
 * and can add a reference column or a note to separate them. Silently creating a second transaction
 * from an ambiguous row would double a position with nothing to show for it.
 */

/** Fixed-width decimals, so 10 and 10.0 and 10.00000000 produce the same key. */
function decimal(value: number, scale: number): string {
  const places = Math.round(Math.log10(scale))
  return quantize(value, scale).toFixed(places)
}

export type FingerprintInput = {
  portfolioId: string
  side: TransactionSide
  symbol: string
  market: MarketId
  tradeDate: string
  quantity: number
  price: number
  fee: number
  /** The broker's own identifier, when the file carries one. */
  reference?: string | null
}

/**
 * The key for one transaction. Deterministic, and stable across re-imports of the same file.
 *
 * Prefixed with a version so a future change to the recipe can be told apart from a key produced by
 * this one — without which, changing the format would silently re-import everyone's history.
 */
export function fingerprintOf(input: FingerprintInput): string {
  const reference = input.reference?.trim()
  if (reference) {
    return `v1:ref:${input.portfolioId}:${reference.slice(0, 120)}`
  }

  return [
    "v1",
    input.portfolioId,
    input.side,
    symbolKey(input.symbol, input.market),
    input.tradeDate.slice(0, 10),
    decimal(input.quantity, QUANTITY_SCALE),
    decimal(input.price, MONEY_SCALE),
    decimal(input.fee, MONEY_SCALE),
  ].join("|")
}

/** Longest a fingerprint can be, matching the database's check constraint. */
export const MAX_FINGERPRINT_LENGTH = 200
