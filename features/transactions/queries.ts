import "server-only"

import { pageRange, toPageResult, type Page, PAGE_SIZE } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"
import { toMarket } from "@/domain/market"
import type { DomainTransaction } from "@/domain/types"
import type { TransactionRow } from "@/types/database"

export async function listTransactions(portfolioId: string): Promise<TransactionRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("trade_date", { ascending: false })
    .order("created_at", { ascending: false })

  if (error) throw error
  // PostgREST serialises numeric as a JSON number, but coerce defensively — a string sneaking into
  // the engine would turn every sum into concatenation.
  return (data ?? []).map((row) => ({
    ...row,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fee: Number(row.fee),
  }))
}

/**
 * The engine only needs these fields; created_at breaks ties within a trade date.
 *
 * **`market` is mapped, and must stay mapped.** Without it every row reaches the engine as `US`:
 * positions key as `US:PTT` while quotes arrive keyed `SET:PTT`, so a Thai holding finds no price,
 * falls back to cost, and is valued in dollars. That was the state before phase 19 — a whole market
 * silently mispriced by one absent field.
 */
export function toDomain(rows: readonly TransactionRow[]): DomainTransaction[] {
  return rows.map((row) => ({
    symbol: row.symbol,
    market: toMarket(row.market),
    side: row.side,
    tradeDate: row.trade_date.slice(0, 10),
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    sequence: Date.parse(row.created_at),
  }))
}

/**
 * One page of transactions for the table. Separate from listTransactions on purpose: holdings and
 * P&L must be computed from every row, so the engine never uses this.
 */
export async function listTransactionsPage(
  portfolioId: string,
  page: number,
  pageSize = PAGE_SIZE,
): Promise<Page<TransactionRow>> {
  const supabase = await createClient()
  const { from, to } = pageRange(page, pageSize)
  const { data, error, count } = await supabase
    .from("transactions")
    .select("*", { count: "exact" })
    .eq("portfolio_id", portfolioId)
    .order("trade_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) throw error
  const rows = (data ?? []).map((row) => ({
    ...row,
    quantity: Number(row.quantity),
    price: Number(row.price),
    fee: Number(row.fee),
  }))
  return toPageResult(rows, count ?? rows.length, page, pageSize)
}
