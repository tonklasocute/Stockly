import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"
import { buildPreview, type ColumnMapping, type ValidatedRow } from "@/domain/import"
import { logger } from "@/lib/log"
import type { Database, ImportSessionRow, TransactionRow } from "@/types/database"
import { existingFingerprints, normalizeGrid } from "./queries"
import type { ApplyRequest } from "./schema"

/**
 * Applying an import.
 *
 * The one place in phase 12 that writes, and the shape is deliberate:
 *
 *   validate everything  ->  decide  ->  insert in bulk  ->  record what happened
 *
 * Validation happens **again here**, against fingerprints read in this request, rather than
 * trusting the preview the client is echoing back. A preview is a courtesy shown to a user; it is
 * not an authorisation, and between seeing one and confirming it the portfolio may have changed.
 *
 * Two things make this safe to run twice. The rows are checked against the keys already stored, and
 * — because two concurrent requests would both pass that check — the unique index on
 * `(user_id, import_fingerprint)` settles it in the database. A 23505 on insert is counted as a
 * duplicate, not raised as an error: it means somebody else already created that exact transaction,
 * which is the outcome the user wanted anyway.
 */

/** Inserted in chunks so one enormous statement cannot time out a serverless function. */
const INSERT_BATCH = 200

export type ApplyResult = {
  session: ImportSessionRow
  created: number
  duplicates: number
  rejected: number
  /** Rows the database refused as duplicates after the in-memory check passed. */
  racedDuplicates: number
}

export class ImportRejected extends Error {
  constructor(
    readonly reason: "HAS_INVALID_ROWS" | "NOTHING_TO_CREATE",
    message: string,
  ) {
    super(message)
    this.name = "ImportRejected"
  }
}

function toInsert(
  row: ValidatedRow,
  request: ApplyRequest,
  userId: string,
  sessionId: string,
) {
  const source = row.row
  return {
    portfolio_id: request.portfolioId,
    user_id: userId, // from the session, never the grid
    symbol: source.symbol as string,
    market: source.market as string,
    side: source.side as TransactionRow["side"],
    trade_date: source.tradeDate as string,
    quantity: source.quantity as number,
    price: source.price as number,
    fee: source.fee as number,
    notes: source.notes,
    // Provenance: what makes "where did this come from?" answerable, and what makes a second
    // import of the same file create nothing.
    import_fingerprint: row.fingerprint,
    import_session_id: sessionId,
    source_row: source.rowNumber,
  }
}

export async function applyImport(
  supabase: SupabaseClient<Database>,
  request: ApplyRequest,
  userId: string,
): Promise<ApplyResult> {
  const rows = normalizeGrid(request.rows, request.mapping as ColumnMapping[], request.headerRow)
  const preview = buildPreview(rows, {
    portfolioId: request.portfolioId,
    existingFingerprints: await existingFingerprints(request.portfolioId),
  })

  // Partial import is a decision the user makes, never one this code makes for them.
  if (preview.rejectCount > 0 && !request.allowPartial) {
    throw new ImportRejected(
      "HAS_INVALID_ROWS",
      `${preview.rejectCount} row${preview.rejectCount === 1 ? "" : "s"} did not pass validation. Fix the file, or choose to import the valid rows only.`,
    )
  }
  if (preview.createCount === 0 && preview.duplicateCount === 0) {
    throw new ImportRejected("NOTHING_TO_CREATE", "No row in that file can be imported.")
  }

  // The session row first, so every transaction can point at it and a failure part-way through
  // still leaves a record of what was attempted.
  const { data: session, error: sessionError } = await supabase
    .from("import_sessions")
    .insert({
      user_id: userId,
      portfolio_id: request.portfolioId,
      // The name is stored for the history list and used as a path by nothing.
      filename: request.filename.slice(0, 255),
      format: request.format,
      status: "FAILED",
      mapping: request.mapping,
      total_rows: preview.totalRows,
      create_count: preview.createCount,
      duplicate_count: preview.duplicateCount,
      reject_count: preview.rejectCount,
      applied_count: 0,
      applied_at: new Date().toISOString(),
    })
    .select("*")
    .single()

  if (sessionError) throw sessionError

  const toCreate = preview.rows.filter((row) => row.outcome === "CREATE")
  let created = 0
  let racedDuplicates = 0

  for (let index = 0; index < toCreate.length; index += INSERT_BATCH) {
    const batch = toCreate.slice(index, index + INSERT_BATCH)
    const payload = batch.map((row) => toInsert(row, request, userId, session.id))

    const { data, error } = await supabase.from("transactions").insert(payload).select("id")

    if (error?.code === "23505") {
      // Somebody imported the same file concurrently. The batch is retried one row at a time so
      // the rows that are genuinely new still land — the alternative is losing a whole batch to
      // one collision.
      for (const single of payload) {
        const { error: singleError } = await supabase.from("transactions").insert(single)
        if (!singleError) created += 1
        else if (singleError.code === "23505") racedDuplicates += 1
        else throw singleError
      }
      continue
    }
    if (error) throw error
    created += data?.length ?? 0
  }

  // Only the rows that did not become transactions are stored. A created row is already a
  // transaction carrying this session's id and its line number.
  const attention = preview.rows.filter((row) => row.outcome !== "CREATE").slice(0, 500)
  if (attention.length > 0) {
    const { error } = await supabase.from("import_rows").insert(
      attention.map((row) => ({
        session_id: session.id,
        user_id: userId,
        row_number: row.row.rowNumber,
        outcome: row.outcome as "DUPLICATE" | "REJECT",
        issues: row.issues,
        // Normalized values only. A broker file can carry an account number, and none of it is
        // needed to explain why a row failed.
        values: {
          tradeDate: row.row.tradeDate,
          symbol: row.row.symbol,
          market: row.row.market,
          side: row.row.side,
          quantity: row.row.quantity,
          price: row.row.price,
          fee: row.row.fee,
        },
      })),
    )
    // A lost audit row must not lose the import that already succeeded.
    if (error) logger.error("import.rows_write_failed", { sessionId: session.id, code: error.code })
  }

  const duplicates = preview.duplicateCount + racedDuplicates
  const status = preview.rejectCount > 0 || duplicates > 0 ? "PARTIAL" : "APPLIED"

  const { data: finished, error: updateError } = await supabase
    .from("import_sessions")
    .update({ status, applied_count: created, duplicate_count: duplicates })
    .eq("id", session.id)
    .select("*")
    .single()

  if (updateError) throw updateError

  // Counters only: no symbols, no amounts, no filename.
  logger.info("import.applied", {
    sessionId: session.id,
    total: preview.totalRows,
    created,
    duplicates,
    rejected: preview.rejectCount,
  })

  return {
    session: finished,
    created,
    duplicates,
    rejected: preview.rejectCount,
    racedDuplicates,
  }
}
