import "server-only"

import { buildPreview, normalizeRow, type ColumnMapping, type ImportPreview } from "@/domain/import"
import { toMarket, type MarketId } from "@/domain/market"
import type { ExistingTransaction } from "@/domain/import"
import { pageRange, toPageResult, type Page, PAGE_SIZE } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"
import type { ImportRowRow, ImportSessionRow } from "@/types/database"

/**
 * Reads for the import feature.
 *
 * The important one is `existingFingerprints`: **one query for the whole portfolio**, not one per
 * imported row. A five-hundred-row file must not become five hundred round trips, and duplicate
 * detection is a set lookup once that set is in hand.
 */

/** Every import key already stored in a portfolio. RLS scopes it to the caller. */
export async function existingFingerprints(portfolioId: string): Promise<Set<string>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("transactions")
    .select("import_fingerprint")
    .eq("portfolio_id", portfolioId)
    .not("import_fingerprint", "is", null)

  if (error) throw error
  return new Set((data ?? []).map((row) => row.import_fingerprint as string))
}

/** Stored transactions in the shape reconciliation compares against. */
export async function transactionsForReconciliation(
  portfolioId: string,
): Promise<ExistingTransaction[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("transactions")
    .select("id, side, symbol, market, trade_date, quantity, price, fee, import_fingerprint")
    .eq("portfolio_id", portfolioId)

  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    side: row.side,
    symbol: row.symbol,
    market: toMarket(row.market),
    tradeDate: row.trade_date.slice(0, 10),
    quantity: Number(row.quantity),
    price: Number(row.price),
    fee: Number(row.fee),
    fingerprint: row.import_fingerprint,
  }))
}

/**
 * Normalizes the data rows of a grid.
 *
 * `headerRow` is the grid index of the header; everything below it is data. Row numbers are
 * 1-based over the whole grid, so they match what a user sees in their spreadsheet rather than an
 * offset only this code understands.
 */
export function normalizeGrid(
  grid: readonly (readonly string[])[],
  mapping: readonly ColumnMapping[],
  headerRow: number,
  defaultMarket: MarketId = "US",
) {
  return grid
    .slice(headerRow + 1)
    .map((row, index) => normalizeRow(row, mapping, headerRow + index + 2, { defaultMarket }))
}

/** The preview for a grid: pure validation against the keys already stored. Writes nothing. */
export async function previewImport(
  grid: readonly (readonly string[])[],
  mapping: readonly ColumnMapping[],
  headerRow: number,
  portfolioId: string,
): Promise<ImportPreview> {
  const rows = normalizeGrid(grid, mapping, headerRow)
  return buildPreview(rows, {
    portfolioId,
    existingFingerprints: await existingFingerprints(portfolioId),
  })
}

// ---------------------------------------------------------------- history

export async function listImportSessions(
  portfolioId: string | undefined,
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<Page<ImportSessionRow>> {
  const supabase = await createClient()
  const { from, to } = pageRange(page, pageSize)

  let query = supabase.from("import_sessions").select("*", { count: "exact" })
  if (portfolioId) query = query.eq("portfolio_id", portfolioId)

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) throw error
  const rows = data ?? []
  return toPageResult(rows, count ?? rows.length, page, pageSize)
}

export async function findImportSession(id: string): Promise<ImportSessionRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("import_sessions").select("*").eq("id", id).maybeSingle()
  if (error) throw error
  return data ?? null
}

/** The rows that did not become transactions — the ones a user has to act on. */
export async function listImportRows(sessionId: string): Promise<ImportRowRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("import_rows")
    .select("*")
    .eq("session_id", sessionId)
    .order("row_number", { ascending: true })
    .limit(500)

  if (error) throw error
  return data ?? []
}

/** How many rows across all of a user's imports were rejected — a data-quality input. */
export async function unresolvedImportRowCount(): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from("import_rows")
    .select("id", { count: "exact", head: true })
    .eq("outcome", "REJECT")

  if (error) throw error
  return count ?? 0
}
