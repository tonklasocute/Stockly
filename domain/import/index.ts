/**
 * The import engine.
 *
 * Pure throughout: no database, no network, no framework. The pipeline is
 *
 *   parse → map → normalize → validate → fingerprint → preview → (apply, elsewhere)
 *
 * and everything up to `apply` is a function of the file plus the fingerprints already stored.
 * Running a preview a hundred times changes nothing, which is what makes it safe to show a user
 * before they commit — and is asserted by `domain/import/invariants.test.ts`.
 *
 * Full methodology in `docs/IMPORT.md`.
 */
export { fingerprintOf, MAX_FINGERPRINT_LENGTH, type FingerprintInput } from "./fingerprint"

export {
  expectedCurrency,
  looksLikeHeader,
  normalizeRow,
  parseCurrency,
  parseDate,
  parseDecimal,
  parseMarket,
  parseSide,
  suggestMapping,
} from "./normalize"

export { buildPreview, fingerprintFor, validateRow } from "./validate"

export {
  RECONCILE_STATUSES,
  describeEntry,
  reconcile,
  type ExistingTransaction,
  type FieldConflict,
  type ReconcileEntry,
  type ReconcileReport,
  type ReconcileStatus,
} from "./reconcile"

export {
  FIELD_HELP,
  IMPORT_ERROR_CODES,
  IMPORT_FIELDS,
  IMPORT_FORMATS,
  IMPORT_SEVERITIES,
  IMPORT_SOURCES,
  IMPORT_STATUSES,
  REQUIRED_FIELDS,
  type ColumnMapping,
  type ImportErrorCode,
  type ImportField,
  type ImportFormat,
  type ImportIssue,
  type ImportPreview,
  type ImportSeverity,
  type ImportSource,
  type ImportStatus,
  type NormalizedRow,
  type RowOutcome,
  type ValidatedRow,
} from "./types"
