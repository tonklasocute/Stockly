import { CURRENCIES, isMarket, isValidSymbol } from "../market"
import { fingerprintOf } from "./fingerprint"
import { expectedCurrency } from "./normalize"
import type {
  ImportIssue,
  ImportPreview,
  NormalizedRow,
  RowOutcome,
  ValidatedRow,
} from "./types"

/**
 * Deterministic row validation.
 *
 * Every rule is checked against the same constraints the database enforces, so a row that passes
 * here cannot fail on insert — an import that reports "112 will be created" and then creates 108 is
 * worse than one that refuses up front.
 *
 * **Nothing is silently corrected.** If the file says a quantity of −5, the row is rejected with
 * `INVALID_QUANTITY` and its number; it is never flipped to 5, and it is never dropped without
 * being counted. A user's financial data is not something to guess at.
 *
 * Pure: the caller supplies the fingerprints that already exist, so duplicate detection is a set
 * lookup rather than a query per row.
 */

/** Matches the `transactions_notes_length` check. */
const MAX_NOTES = 500

/** Tomorrow in UTC, so a user a day ahead of the server can still record today's trade. */
function latestAllowedDate(now: Date): string {
  const at = new Date(now)
  at.setUTCDate(at.getUTCDate() + 1)
  return at.toISOString().slice(0, 10)
}

function issue(
  row: NormalizedRow,
  field: ImportIssue["field"],
  code: ImportIssue["code"],
  message: string,
  severity: ImportIssue["severity"] = "ERROR",
): ImportIssue {
  return { rowNumber: row.rowNumber, field, code, message, severity }
}

/** Everything wrong with one row, in the order a person would read it. */
export function validateRow(row: NormalizedRow, now: Date): ImportIssue[] {
  const issues: ImportIssue[] = []

  // ---- date
  if (row.tradeDate === null) {
    issues.push(
      issue(
        row,
        "tradeDate",
        "INVALID_DATE",
        "The trade date is missing or could not be read. Use YYYY-MM-DD, or a format where the day and month are unambiguous.",
      ),
    )
  } else if (row.tradeDate > latestAllowedDate(now)) {
    issues.push(issue(row, "tradeDate", "FUTURE_DATE", "The trade date is in the future."))
  }

  // ---- instrument
  if (row.symbol === null) {
    issues.push(issue(row, "symbol", "MISSING_REQUIRED_FIELD", "The symbol is missing."))
  } else if (row.market !== null && !isValidSymbol(row.symbol, row.market)) {
    issues.push(
      issue(row, "symbol", "INVALID_SYMBOL", `"${row.symbol}" is not a valid symbol on ${row.market}.`),
    )
  }

  if (row.market === null || !isMarket(row.market)) {
    issues.push(
      issue(row, "market", "INVALID_MARKET", "The market must be US or SET."),
    )
  }

  // ---- side
  if (row.side === null) {
    issues.push(
      issue(
        row,
        "side",
        "INVALID_TRANSACTION_TYPE",
        "The side could not be read. Stockly imports buys and sells; dividends and cash movements are recorded separately.",
      ),
    )
  }

  // ---- amounts
  if (row.quantity === null) {
    issues.push(issue(row, "quantity", "INVALID_QUANTITY", "The quantity is missing or could not be read."))
  } else if (!(row.quantity > 0)) {
    // Direction lives in `side`, so a negative quantity is a file whose convention Stockly does not
    // share — and guessing which it meant would be inventing a trade.
    issues.push(
      issue(
        row,
        "quantity",
        "INVALID_QUANTITY",
        "The quantity must be above zero. A sale is expressed by the side, not by a negative quantity.",
      ),
    )
  }

  if (row.price === null) {
    issues.push(issue(row, "price", "INVALID_PRICE", "The price is missing or could not be read."))
  } else if (row.price < 0) {
    issues.push(issue(row, "price", "INVALID_PRICE", "The price cannot be negative."))
  }

  if (row.fee === null) {
    issues.push(issue(row, "fee", "INVALID_FEE", "The fee could not be read."))
  } else if (row.fee < 0) {
    issues.push(issue(row, "fee", "INVALID_FEE", "The fee cannot be negative."))
  }

  // ---- currency
  //
  // Not stored: an instrument's currency is derived from its venue (phase 9). A stated currency is
  // therefore checked rather than kept, and a disagreement is a warning — the row still imports,
  // priced in the market's currency, and the user is told which one that is.
  if (row.currency !== null && !CURRENCIES.includes(row.currency)) {
    issues.push(issue(row, "currency", "UNSUPPORTED_CURRENCY", `${row.currency} is not supported.`))
  } else if (row.currency !== null && row.market !== null) {
    const expected = expectedCurrency(row.market)
    if (row.currency !== expected) {
      issues.push(
        issue(
          row,
          "currency",
          "CURRENCY_MISMATCH",
          `The file says ${row.currency}, but instruments on ${row.market} trade in ${expected}. The price will be read as ${expected}.`,
          "WARNING",
        ),
      )
    }
  }

  if (row.notes !== null && row.notes.length > MAX_NOTES) {
    issues.push(
      issue(row, "notes", "NOTES_TOO_LONG", `Notes are capped at ${MAX_NOTES} characters.`),
    )
  }

  return issues
}

/** The fingerprint for a row, or null when it lacks the fields that identify a transaction. */
export function fingerprintFor(row: NormalizedRow, portfolioId: string): string | null {
  if (
    row.tradeDate === null ||
    row.symbol === null ||
    row.market === null ||
    row.side === null ||
    row.quantity === null ||
    row.price === null ||
    row.fee === null
  ) {
    return null
  }
  return fingerprintOf({
    portfolioId,
    side: row.side,
    symbol: row.symbol,
    market: row.market,
    tradeDate: row.tradeDate,
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    reference: row.reference,
  })
}

/**
 * Validates every row and decides what each will do.
 *
 * `existingFingerprints` is the set already in the portfolio — one query, not one per row. Rows
 * that duplicate each other *within the same file* are also caught, so a file listing the same
 * trade twice imports it once and says so.
 *
 * A rejected row is never counted as a duplicate even if it matches one: the user needs to see the
 * validation error, not a reassuring "already imported".
 */
export function buildPreview(
  rows: readonly NormalizedRow[],
  {
    portfolioId,
    existingFingerprints,
    now = new Date(),
    blankRows = 0,
  }: {
    portfolioId: string
    existingFingerprints: ReadonlySet<string>
    now?: Date
    blankRows?: number
  },
): ImportPreview {
  const seenInFile = new Set<string>()
  const validated: ValidatedRow[] = []

  for (const row of rows) {
    const issues = validateRow(row, now)
    const fingerprint = fingerprintFor(row, portfolioId)
    let outcome: RowOutcome = issues.some((i) => i.severity === "ERROR") ? "REJECT" : "CREATE"

    if (outcome === "CREATE" && fingerprint !== null) {
      if (existingFingerprints.has(fingerprint)) {
        outcome = "DUPLICATE"
        issues.push({
          rowNumber: row.rowNumber,
          field: null,
          code: "DUPLICATE_TRANSACTION",
          message: "This transaction is already in the portfolio. It will be skipped.",
          severity: "INFO",
        })
      } else if (seenInFile.has(fingerprint)) {
        outcome = "DUPLICATE"
        issues.push({
          rowNumber: row.rowNumber,
          field: null,
          code: "DUPLICATE_IN_FILE",
          message: "An identical row appears earlier in this file. It will be imported once.",
          severity: "INFO",
        })
      } else {
        seenInFile.add(fingerprint)
      }
    }

    validated.push({ row, outcome, issues, fingerprint })
  }

  return {
    rows: validated,
    totalRows: validated.length,
    createCount: validated.filter((r) => r.outcome === "CREATE").length,
    duplicateCount: validated.filter((r) => r.outcome === "DUPLICATE").length,
    rejectCount: validated.filter((r) => r.outcome === "REJECT").length,
    warningCount: validated.filter((r) => r.issues.some((i) => i.severity === "WARNING")).length,
    blankRows,
  }
}
