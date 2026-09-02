import "server-only"

import { baseCurrencyOf } from "@/domain/market"
import type { DomainCashTransaction } from "@/domain/cash"
import { pageRange, toPageResult, type Page, PAGE_SIZE } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"
import type { CashTransactionRow } from "@/types/database"

export async function listCashTransactions(portfolioId: string): Promise<CashTransactionRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("cash_transactions")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })

  if (error) throw error
  return (data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }))
}

export function toDomainCash(rows: readonly CashTransactionRow[]): DomainCashTransaction[] {
  return rows.map((row) => ({
    kind: row.kind,
    amount: row.amount,
    currency: baseCurrencyOf(row.currency),
    occurredOn: row.occurred_on.slice(0, 10),
  }))
}

export async function listCashPage(
  portfolioId: string,
  page: number,
  pageSize = PAGE_SIZE,
): Promise<Page<CashTransactionRow>> {
  const supabase = await createClient()
  const { from, to } = pageRange(page, pageSize)
  const { data, error, count } = await supabase
    .from("cash_transactions")
    .select("*", { count: "exact" })
    .eq("portfolio_id", portfolioId)
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) throw error
  const rows = (data ?? []).map((row) => ({ ...row, amount: Number(row.amount) }))
  return toPageResult(rows, count ?? rows.length, page, pageSize)
}
