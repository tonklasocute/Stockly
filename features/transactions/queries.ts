import "server-only"

import { createClient } from "@/lib/supabase/server"
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

/** The engine only needs these fields; created_at breaks ties within a trade date. */
export function toDomain(rows: readonly TransactionRow[]): DomainTransaction[] {
  return rows.map((row) => ({
    symbol: row.symbol,
    side: row.side,
    tradeDate: row.trade_date.slice(0, 10),
    quantity: row.quantity,
    price: row.price,
    fee: row.fee,
    sequence: Date.parse(row.created_at),
  }))
}
