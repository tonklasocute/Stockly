import { roundTo } from "../money"
import { symbolKey, type MarketId } from "../market"
import type { TransactionSide } from "../types"
import { fingerprintOf } from "./fingerprint"
import type { NormalizedRow } from "./types"

/**
 * Reconciliation: comparing a file against what Stockly already holds.
 *
 * The rule that shapes it, and the one worth defending against every future "wouldn't it be easier
 * if…": **nothing here overwrites anything.** A conflict is reported, with both sides visible, and
 * the user decides. Silently correcting a stored transaction to match a file would make the
 * transaction table unauditable — the one thing it must never be.
 *
 * Pure: both sides are passed in.
 */

export const RECONCILE_STATUSES = [
  "MATCHED",
  "MISSING_IN_STOCKLY",
  "MISSING_IN_SOURCE",
  "CONFLICT",
  "DUPLICATE_IN_SOURCE",
] as const
export type ReconcileStatus = (typeof RECONCILE_STATUSES)[number]

/** The subset of a stored transaction reconciliation compares. */
export type ExistingTransaction = {
  id: string
  side: TransactionSide
  symbol: string
  market: MarketId
  tradeDate: string
  quantity: number
  price: number
  fee: number
  /** The key it was imported under, when it was imported at all. */
  fingerprint: string | null
}

export type FieldConflict = {
  field: "tradeDate" | "quantity" | "price" | "fee" | "side" | "market"
  source: string
  stockly: string
}

export type ReconcileEntry = {
  status: ReconcileStatus
  /** The row from the file, when there is one. */
  row: NormalizedRow | null
  /** The stored transaction, when there is one. */
  existing: ExistingTransaction | null
  /** Populated only for CONFLICT: what the two disagree about. */
  conflicts: FieldConflict[]
}

export type ReconcileReport = {
  entries: ReconcileEntry[]
  matched: number
  missingInStockly: number
  missingInSource: number
  conflicts: number
  duplicatesInSource: number
  /**
   * Stored transactions that carry no import fingerprint and so cannot be matched by key.
   *
   * Counted rather than reported as "missing in source": a hand-entered transaction is not a
   * discrepancy, it simply was not imported, and listing it as one would bury the real findings.
   */
  unfingerprinted: number
}

/** The identity used when a row has a broker reference — same rule as `fingerprintOf`. */
function keyOf(row: NormalizedRow, portfolioId: string): string | null {
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

const money = (value: number) => roundTo(value, 6).toString()
const shares = (value: number) => roundTo(value, 8).toString()

/**
 * What the two sides disagree about.
 *
 * Only reachable when the fingerprints matched, which — since a value-based fingerprint includes
 * every one of these fields — means in practice a **reference-keyed** row whose values were
 * corrected at the broker. That is exactly the case worth surfacing and never auto-applying.
 */
function conflictsBetween(row: NormalizedRow, existing: ExistingTransaction): FieldConflict[] {
  const out: FieldConflict[] = []

  if (row.tradeDate !== null && row.tradeDate !== existing.tradeDate.slice(0, 10)) {
    out.push({ field: "tradeDate", source: row.tradeDate, stockly: existing.tradeDate.slice(0, 10) })
  }
  if (row.side !== null && row.side !== existing.side) {
    out.push({ field: "side", source: row.side, stockly: existing.side })
  }
  if (row.market !== null && row.market !== existing.market) {
    out.push({ field: "market", source: row.market, stockly: existing.market })
  }
  if (row.quantity !== null && shares(row.quantity) !== shares(existing.quantity)) {
    out.push({ field: "quantity", source: shares(row.quantity), stockly: shares(existing.quantity) })
  }
  if (row.price !== null && money(row.price) !== money(existing.price)) {
    out.push({ field: "price", source: money(row.price), stockly: money(existing.price) })
  }
  if (row.fee !== null && money(row.fee) !== money(existing.fee)) {
    out.push({ field: "fee", source: money(row.fee), stockly: money(existing.fee) })
  }

  return out
}

/**
 * Compares a parsed file against a portfolio's stored transactions.
 *
 * `MISSING_IN_SOURCE` is reported only for transactions that **were** imported — one carrying a
 * fingerprint the file no longer contains. A transaction entered by hand has no fingerprint and is
 * counted separately, because "you typed this in yourself" is not a reconciliation finding.
 */
export function reconcile(
  rows: readonly NormalizedRow[],
  existing: readonly ExistingTransaction[],
  portfolioId: string,
): ReconcileReport {
  const byFingerprint = new Map<string, ExistingTransaction>()
  let unfingerprinted = 0
  for (const transaction of existing) {
    if (transaction.fingerprint) byFingerprint.set(transaction.fingerprint, transaction)
    else unfingerprinted += 1
  }

  const entries: ReconcileEntry[] = []
  const seenInSource = new Set<string>()
  const matchedFingerprints = new Set<string>()

  for (const row of rows) {
    const key = keyOf(row, portfolioId)

    if (key === null) {
      // A row too incomplete to identify cannot be reconciled against anything.
      entries.push({ status: "MISSING_IN_STOCKLY", row, existing: null, conflicts: [] })
      continue
    }

    if (seenInSource.has(key)) {
      entries.push({ status: "DUPLICATE_IN_SOURCE", row, existing: null, conflicts: [] })
      continue
    }
    seenInSource.add(key)

    const match = byFingerprint.get(key)
    if (!match) {
      entries.push({ status: "MISSING_IN_STOCKLY", row, existing: null, conflicts: [] })
      continue
    }

    matchedFingerprints.add(key)
    const conflicts = conflictsBetween(row, match)
    entries.push({
      status: conflicts.length > 0 ? "CONFLICT" : "MATCHED",
      row,
      existing: match,
      conflicts,
    })
  }

  for (const [fingerprint, transaction] of byFingerprint) {
    if (!matchedFingerprints.has(fingerprint)) {
      entries.push({ status: "MISSING_IN_SOURCE", row: null, existing: transaction, conflicts: [] })
    }
  }

  const count = (status: ReconcileStatus) => entries.filter((e) => e.status === status).length

  return {
    entries,
    matched: count("MATCHED"),
    missingInStockly: count("MISSING_IN_STOCKLY"),
    missingInSource: count("MISSING_IN_SOURCE"),
    conflicts: count("CONFLICT"),
    duplicatesInSource: count("DUPLICATE_IN_SOURCE"),
    unfingerprinted,
  }
}

/** A stable label for an entry, for the UI and for a CSV of the report. */
export function describeEntry(entry: ReconcileEntry): string {
  const row = entry.row
  const existing = entry.existing
  const symbol = row?.symbol ?? existing?.symbol ?? "—"
  const market = row?.market ?? existing?.market ?? "US"
  return `${symbolKey(symbol, market)} · ${row?.tradeDate ?? existing?.tradeDate.slice(0, 10) ?? "—"}`
}
