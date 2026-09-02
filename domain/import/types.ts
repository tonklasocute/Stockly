import type { Currency, MarketId } from "../market"
import type { TransactionSide } from "../types"

/**
 * The import pipeline's shared vocabulary.
 *
 * The shape of the whole phase, and the reason each stage is separate:
 *
 *   file → parse → map → normalize → validate → fingerprint → preview → apply → transactions
 *
 * Nothing before `apply` touches the portfolio. A preview is a pure function of the parsed rows and
 * the fingerprints already in the database; running one a hundred times changes nothing, which is
 * what makes it safe to put in front of a user before they commit.
 *
 * Everything here is pure: no database, no network, no framework.
 */

export const IMPORT_FORMATS = ["CSV", "XLSX"] as const
export type ImportFormat = (typeof IMPORT_FORMATS)[number]

/**
 * Where the rows came from.
 *
 * `GENERIC` is the mapped-by-the-user path and is the only one phase 12 ships. A broker adapter
 * adds a value here plus a detector and a column map — it does **not** get to change the pipeline,
 * which is the point of keeping the source type out of the engine.
 */
export const IMPORT_SOURCES = ["GENERIC"] as const
export type ImportSource = (typeof IMPORT_SOURCES)[number]

export const IMPORT_STATUSES = [
  "MAPPING",
  "VALIDATED",
  "APPLIED",
  "PARTIAL",
  "CANCELLED",
  "FAILED",
] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

/**
 * The fields an imported row can populate.
 *
 * Deliberately the transaction model Stockly already has, and nothing more. Inventing a field the
 * domain cannot store would produce an import that appears to succeed and silently drops data.
 */
export const IMPORT_FIELDS = [
  "tradeDate",
  "symbol",
  "market",
  "side",
  "quantity",
  "price",
  "fee",
  "currency",
  "notes",
  "reference",
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]

export const REQUIRED_FIELDS: readonly ImportField[] = [
  "tradeDate",
  "symbol",
  "side",
  "quantity",
  "price",
]

export const FIELD_LABELS: Record<ImportField, string> = {
  tradeDate: "Trade date",
  symbol: "Symbol",
  market: "Market",
  side: "Side",
  quantity: "Quantity",
  price: "Price",
  fee: "Fee",
  currency: "Currency",
  notes: "Notes",
  reference: "Broker reference",
}

export const FIELD_HELP: Record<ImportField, string> = {
  tradeDate: "The date the trade happened. Required.",
  symbol: "The ticker. Required.",
  market: "US or SET. Defaults to US, matching the database column.",
  side: "Buy or sell. Required.",
  quantity: "Shares. Must be above zero. Required.",
  price: "Price per share, in the instrument's own currency. Required.",
  fee: "Commission and charges. Defaults to zero when the column is absent.",
  currency:
    "Checked against the market's currency rather than stored: an instrument's currency is derived from its venue.",
  notes: "Free text, kept on the transaction.",
  reference:
    "The broker's own identifier for the trade. When present it becomes the idempotency key, so a corrected row is a conflict rather than a second transaction.",
}

/** A column in the uploaded file, bound to the field it fills. */
export type ColumnMapping = {
  /** Index into the parsed row. Null means "this field has no column". */
  columnIndex: number | null
  field: ImportField
}

// ---------------------------------------------------------------- rows

/**
 * A row after mapping and normalization, before validation.
 *
 * Every field is nullable because every one of them genuinely can be missing or unparseable, and a
 * row that failed to produce a date must reach validation as a row with no date — not as a row
 * quietly dated today.
 */
export type NormalizedRow = {
  /** 1-based, counting the header, so it matches what the user sees in a spreadsheet. */
  rowNumber: number
  tradeDate: string | null
  symbol: string | null
  market: MarketId | null
  side: TransactionSide | null
  quantity: number | null
  price: number | null
  fee: number | null
  currency: Currency | null
  notes: string | null
  reference: string | null
  /** The cells as they were read, kept for the preview so a user can see what the file said. */
  raw: readonly string[]
}

// ---------------------------------------------------------------- validation

export const IMPORT_ERROR_CODES = [
  "MISSING_REQUIRED_FIELD",
  "INVALID_DATE",
  "FUTURE_DATE",
  "INVALID_SYMBOL",
  "INVALID_MARKET",
  "INVALID_TRANSACTION_TYPE",
  "INVALID_QUANTITY",
  "INVALID_PRICE",
  "INVALID_FEE",
  "UNSUPPORTED_CURRENCY",
  "CURRENCY_MISMATCH",
  "NOTES_TOO_LONG",
  "DUPLICATE_TRANSACTION",
  "DUPLICATE_IN_FILE",
] as const
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number]

export const IMPORT_SEVERITIES = ["ERROR", "WARNING", "INFO"] as const
export type ImportSeverity = (typeof IMPORT_SEVERITIES)[number]

/**
 * A structured problem with one row.
 *
 * `code` is what a test asserts and a UI branches on; `message` is for the person reading it. A
 * codeless string would make every consumer match on prose.
 */
export type ImportIssue = {
  rowNumber: number
  field: ImportField | null
  code: ImportErrorCode
  message: string
  severity: ImportSeverity
}

/** What a row will do when the import is applied. */
export type RowOutcome = "CREATE" | "DUPLICATE" | "REJECT"

export type ValidatedRow = {
  row: NormalizedRow
  outcome: RowOutcome
  issues: ImportIssue[]
  /**
   * The idempotency key. Present whenever the row has enough fields to identify a transaction —
   * including on a rejected row, so reconciliation can still match it against what exists.
   */
  fingerprint: string | null
}

export type ImportPreview = {
  rows: ValidatedRow[]
  totalRows: number
  createCount: number
  duplicateCount: number
  rejectCount: number
  warningCount: number
  /** Blank lines dropped by the parser. Reported rather than silently skipped. */
  blankRows: number
}
