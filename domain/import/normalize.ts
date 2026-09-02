import { QUANTITY_SCALE, quantize } from "../money"
import {
  currencyOf,
  isCurrency,
  isMarket,
  normalizeSymbol,
  type Currency,
  type MarketId,
} from "../market"
import type { TransactionSide } from "../types"
import type { ColumnMapping, ImportField, NormalizedRow } from "./types"
import { IMPORT_FIELDS } from "./types"

/**
 * Turning a spreadsheet cell into something the domain can hold.
 *
 * The rule underneath every function here: **a value that cannot be read honestly becomes `null`,
 * never a guess.** A date that does not parse must not become today; a quantity that does not parse
 * must not become zero. Null reaches validation, which reports the row number and the field, and
 * the user fixes their file. That is the whole difference between an import that can be trusted and
 * one that quietly invents transactions.
 *
 * Normalization happens **here and nowhere else**, so "usd" and " USD " cannot become two different
 * currencies depending on which code path read them.
 */

// ---------------------------------------------------------------- header detection

/**
 * The header names real exports use, mapped to the field they fill.
 *
 * Matched case- and punctuation-insensitively. This only produces a *suggested* mapping — the user
 * confirms it before anything is imported, because a wrong guess here is a wrong transaction and no
 * heuristic is worth that on its own.
 */
const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  tradeDate: ["date", "tradedate", "transactiondate", "settlementdate", "dealdate", "when", "datetime"],
  symbol: ["symbol", "ticker", "instrument", "security", "stock", "code", "name"],
  market: ["market", "exchange", "venue", "mic"],
  side: ["side", "type", "action", "transactiontype", "buysell", "direction", "operation"],
  quantity: ["quantity", "qty", "shares", "units", "volume", "amount"],
  price: ["price", "unitprice", "pricepershare", "rate", "executionprice", "avgprice"],
  fee: ["fee", "fees", "commission", "charges", "brokerage", "cost"],
  currency: ["currency", "ccy", "curr"],
  notes: ["notes", "note", "memo", "description", "remark", "comment"],
  reference: ["reference", "ref", "id", "transactionid", "orderid", "dealid", "confirmation"],
}

function canonical(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "")
}

/**
 * A suggested column mapping from the header row.
 *
 * Each field takes the first unclaimed column whose header matches one of its aliases, in field
 * order — so `quantity` claims an "amount" column before `notes` could, which is the reading a
 * trade file almost always wants. Anything unmatched is left null for the user to fill in.
 */
export function suggestMapping(headerRow: readonly string[]): ColumnMapping[] {
  const claimed = new Set<number>()

  return IMPORT_FIELDS.map((field) => {
    const aliases = HEADER_ALIASES[field]
    const index = headerRow.findIndex(
      (header, position) => !claimed.has(position) && aliases.includes(canonical(header)),
    )
    if (index >= 0) claimed.add(index)
    return { field, columnIndex: index >= 0 ? index : null }
  })
}

/**
 * Whether a row looks like a header rather than data.
 *
 * A header has text in most cells and no parseable date in the column a date would be in. Used only
 * to *default* the header-row choice; the user can override it.
 */
export function looksLikeHeader(row: readonly string[]): boolean {
  const filled = row.filter((cell) => cell.trim() !== "")
  if (filled.length === 0) return false
  const numeric = filled.filter((cell) => parseDecimal(cell) !== null).length
  const dated = filled.filter((cell) => parseDate(cell) !== null).length
  return numeric === 0 && dated === 0
}

// ---------------------------------------------------------------- value parsing

/**
 * A decimal from a spreadsheet cell.
 *
 * Handles the shapes a real export contains: thousands separators, a currency symbol, a trailing
 * or leading sign, parentheses for negatives, and the European convention where the comma is the
 * decimal point. Returns `null` for anything it cannot read — never 0, which would turn an
 * unreadable price into a free share.
 *
 * The comma rule is the delicate one. `1,234.56` is Anglo; `1.234,56` is European; `1,23` is
 * European; `1,234` is ambiguous and is read as Anglo thousands, which is the commoner file.
 */
export function parseDecimal(input: string | null | undefined): number | null {
  if (input === null || input === undefined) return null
  let text = String(input).trim()
  if (text === "") return null

  // Accounting negatives: (1,234.56)
  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1).trim()
  }

  // Strip currency symbols, codes and spaces — including the non-breaking kind Excel emits.
  text = text.replace(/[\s  ]/g, "").replace(/^[^\d\-+.,]+|[^\d.,]+$/g, "")
  if (text === "") return null

  if (text.startsWith("-")) {
    negative = !negative
    text = text.slice(1)
  } else if (text.startsWith("+")) {
    text = text.slice(1)
  }

  const lastComma = text.lastIndexOf(",")
  const lastDot = text.lastIndexOf(".")

  if (lastComma >= 0 && lastDot >= 0) {
    // Whichever comes last is the decimal separator; the other is a grouping mark.
    text = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "")
  } else if (lastComma >= 0) {
    const decimals = text.length - lastComma - 1
    // Exactly three digits after a single comma is thousands (1,234). Anything else is a decimal.
    const isThousands = decimals === 3 && (text.match(/,/g) ?? []).length >= 1 && !/,\d{3}\d/.test(text)
    text = isThousands ? text.replace(/,/g, "") : text.replace(",", ".")
  }

  if (!/^\d*\.?\d*$/.test(text) || text === "" || text === ".") return null
  const value = Number(text)
  if (!Number.isFinite(value)) return null
  return negative ? -value : value
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const SLASHED = /^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{1,4})$/

/**
 * A trade date from a cell, as an ISO date string.
 *
 * **No timezone conversion happens anywhere in here**, deliberately. A trade date is a calendar
 * date on an exchange, not an instant; running it through a `Date` in the server's zone is how a
 * 2nd-of-January trade in Bangkok becomes the 1st in a US datacentre. The string is taken apart and
 * reassembled as a string, and only then range-checked.
 *
 * Ambiguous day/month order (`03/04/2026`) is refused rather than guessed: the difference between
 * March and April in a transaction history is not something to coin-flip. An unambiguous ordering —
 * a day above 12, or a four-digit year first — is read.
 */
export function parseDate(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null
  const text = String(input).trim()
  if (text === "") return null

  // Already ISO, possibly with a time part the domain does not store.
  const isoPrefix = text.slice(0, 10)
  const iso = ISO_DATE.exec(isoPrefix)
  if (iso) return validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))

  const parts = SLASHED.exec(text)
  if (!parts) return null
  const [, a, b, c] = parts.map(Number) as unknown as [string, number, number, number]

  // yyyy/mm/dd
  if (a > 31) return validDate(a, b, c)
  if (c <= 31) return null // no four-digit year anywhere: unreadable rather than guessed

  // dd/mm/yyyy vs mm/dd/yyyy. Only an unambiguous pair is accepted.
  if (a > 12 && b <= 12) return validDate(c, b, a)
  if (b > 12 && a <= 12) return validDate(c, a, b)
  return null
}

/** Rejects a date that does not exist — 31 February is a typo, not a trade. */
function validDate(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2200 || month < 1 || month > 12 || day < 1 || day > 31) return null
  const at = new Date(Date.UTC(year, month - 1, day))
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    return null
  }
  return at.toISOString().slice(0, 10)
}

const BUY_WORDS = new Set(["buy", "b", "bought", "purchase", "purchased", "long", "bot", "debit"])
const SELL_WORDS = new Set(["sell", "s", "sold", "sale", "sll", "short", "credit"])

/** Buy or sell from whatever the broker called it. Null for anything else, including a transfer. */
export function parseSide(input: string | null | undefined): TransactionSide | null {
  if (input === null || input === undefined) return null
  const text = String(input).trim().toLowerCase().replace(/[^a-z]/g, "")
  if (text === "") return null
  if (BUY_WORDS.has(text)) return "buy"
  if (SELL_WORDS.has(text)) return "sell"
  return null
}

export function parseCurrency(input: string | null | undefined): Currency | null {
  if (input === null || input === undefined) return null
  const text = String(input).trim().toUpperCase()
  return isCurrency(text) ? text : null
}

/** A market from a cell, accepting the venue names an export is likely to carry. */
export function parseMarket(input: string | null | undefined): MarketId | null {
  if (input === null || input === undefined) return null
  const text = String(input).trim().toUpperCase()
  if (isMarket(text)) return text
  if (["NASDAQ", "NYSE", "AMEX", "BATS", "ARCA", "USA", "UNITED STATES"].includes(text)) return "US"
  if (["SET", "MAI", "TH", "THAILAND", "XBKK"].includes(text)) return "SET"
  return null
}

// ---------------------------------------------------------------- mapping

function cell(row: readonly string[], mapping: readonly ColumnMapping[], field: ImportField): string | null {
  const index = mapping.find((entry) => entry.field === field)?.columnIndex
  if (index === null || index === undefined) return null
  const value = row[index]
  return value === undefined ? null : value
}

/**
 * Applies a mapping to one parsed row.
 *
 * Quantities are quantized to the eight decimal places the column stores; money to six, matching
 * `domain/money.ts`. Quantizing here rather than at insert means the fingerprint is computed from
 * exactly the value that will be written, so a re-import of the same file produces the same key.
 */
export function normalizeRow(
  raw: readonly string[],
  mapping: readonly ColumnMapping[],
  rowNumber: number,
  { defaultMarket = "US" as MarketId }: { defaultMarket?: MarketId } = {},
): NormalizedRow {
  const market = parseMarket(cell(raw, mapping, "market")) ?? defaultMarket
  const quantity = parseDecimal(cell(raw, mapping, "quantity"))
  const price = parseDecimal(cell(raw, mapping, "price"))
  const fee = parseDecimal(cell(raw, mapping, "fee"))
  const notes = cell(raw, mapping, "notes")?.trim() ?? null
  const reference = cell(raw, mapping, "reference")?.trim() ?? null
  const symbol = normalizeSymbol(cell(raw, mapping, "symbol") ?? "")

  return {
    rowNumber,
    tradeDate: parseDate(cell(raw, mapping, "tradeDate")),
    symbol: symbol === "" ? null : symbol,
    market,
    side: parseSide(cell(raw, mapping, "side")),
    quantity: quantity === null ? null : quantize(quantity, QUANTITY_SCALE),
    price: price === null ? null : quantize(price),
    // No fee column means no fee, which is the documented default for the database column too.
    // A column that is present but unreadable stays null and fails validation.
    fee: cell(raw, mapping, "fee") === null ? 0 : fee === null ? null : quantize(fee),
    currency: parseCurrency(cell(raw, mapping, "currency")),
    notes: notes === "" ? null : notes,
    reference: reference === "" ? null : reference,
    raw,
  }
}

/** The currency an instrument on this market trades in — what a stated currency is checked against. */
export function expectedCurrency(market: MarketId): Currency {
  return currencyOf(market)
}
