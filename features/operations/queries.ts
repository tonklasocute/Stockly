import "server-only"

import { cache } from "react"
import { toMarket } from "@/domain/market"
import type { ShareAdjustment } from "@/domain/corporate-actions"
import { pageRange, toPageResult, type Page, PAGE_SIZE } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"
import type {
  FinancialAuditRow,
  ReconciliationItemRow,
  ReconciliationRunRow,
  ShareAdjustmentRow,
} from "@/types/database"

/**
 * Reads for the operations layer. Every one is scoped by RLS; none of them writes.
 *
 * `listShareAdjustments` is `cache()`d because both portfolio loaders call it on the same request
 * — the dashboard and the analytics pass — and a split is a handful of rows that must not become a
 * second database round trip per page section.
 */

export const listShareAdjustments = cache(
  async (portfolioId: string): Promise<ShareAdjustmentRow[]> => {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from("share_adjustments")
      .select("*")
      .eq("portfolio_id", portfolioId)
      .order("effective_date", { ascending: true })

    if (error) throw error
    // PostgREST serialises numeric as a JSON number; coerce defensively, because a string ratio
    // would turn a multiplication into a concatenation.
    return (data ?? []).map((row) => ({
      ...row,
      numerator: Number(row.numerator),
      denominator: Number(row.denominator),
    }))
  },
)

/** The engine's shape. Nothing but the five fields the arithmetic needs. */
export function toDomainAdjustments(rows: readonly ShareAdjustmentRow[]): ShareAdjustment[] {
  return rows.map((row) => ({
    symbol: row.symbol,
    market: toMarket(row.market),
    effectiveDate: row.effective_date.slice(0, 10),
    numerator: row.numerator,
    denominator: row.denominator,
  }))
}

/**
 * The adjustments for a portfolio, ready to apply.
 *
 * Returns an empty array on failure rather than throwing. A page that cannot read its adjustments
 * shows the unadjusted portfolio, which is the state it was in before phase 19 — degrading to a
 * previous correct behaviour beats an error screen over a table of numbers that are still right.
 */
export const adjustmentsFor = cache(async (portfolioId: string): Promise<ShareAdjustment[]> => {
  try {
    return toDomainAdjustments(await listShareAdjustments(portfolioId))
  } catch {
    return []
  }
})

export async function listRuns(portfolioId: string, limit = 20): Promise<ReconciliationRunRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("reconciliation_runs")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("started_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

export async function getRun(id: string): Promise<ReconciliationRunRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("reconciliation_runs")
    .select("*")
    .eq("id", id)
    .maybeSingle()

  if (error) throw error
  return data
}

/** One run's findings, paginated — a statement of five hundred positions is five hundred rows. */
export async function listItems(
  runId: string,
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<Page<ReconciliationItemRow>> {
  const supabase = await createClient()
  const { from, to } = pageRange(page, pageSize)
  const { data, error, count } = await supabase
    .from("reconciliation_items")
    .select("*", { count: "exact" })
    .eq("run_id", runId)
    .order("scope", { ascending: true })
    .order("status", { ascending: true })
    .order("symbol", { ascending: true, nullsFirst: false })
    .range(from, to)

  if (error) throw error
  const rows = data ?? []
  return toPageResult(rows, count ?? rows.length, page, pageSize)
}

/** Every finding for a run, for the summary counts. Bounded by the statement cap. */
export async function allItems(runId: string): Promise<ReconciliationItemRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("reconciliation_items")
    .select("*")
    .eq("run_id", runId)

  if (error) throw error
  return data ?? []
}

/** How many findings across a portfolio's most recent run still need attention. */
export const unresolvedCount = cache(async (portfolioId: string): Promise<number> => {
  const [latest] = await listRuns(portfolioId, 1)
  if (!latest) return 0
  const supabase = await createClient()
  const { count, error } = await supabase
    .from("reconciliation_items")
    .select("id", { count: "exact", head: true })
    .eq("run_id", latest.id)
    .is("resolved_at", null)

  if (error) throw error
  return count ?? 0
})

/**
 * The audit trail for one row, newest first.
 *
 * Read-only by construction: the table has no insert, update or delete policy, so there is no
 * write counterpart to this function anywhere in the codebase.
 */
export async function auditFor(
  entityId: string,
  limit = 50,
): Promise<FinancialAuditRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("financial_audit")
    .select("*")
    .eq("entity_id", entityId)
    .order("occurred_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

export async function auditForPortfolio(
  portfolioId: string,
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<Page<FinancialAuditRow>> {
  const supabase = await createClient()
  const { from, to } = pageRange(page, pageSize)
  const { data, error, count } = await supabase
    .from("financial_audit")
    .select("*", { count: "exact" })
    .eq("portfolio_id", portfolioId)
    .order("occurred_at", { ascending: false })
    .range(from, to)

  if (error) throw error
  const rows = data ?? []
  return toPageResult(rows, count ?? rows.length, page, pageSize)
}
