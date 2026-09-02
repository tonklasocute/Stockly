import "server-only"

import { baseCurrencyOf } from "@/domain/market"
import type { DomainDividend } from "@/domain/dividends"
import { pageRange, toPageResult, type Page, PAGE_SIZE } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"
import type { DividendRow } from "@/types/database"

export async function listDividends(portfolioId: string): Promise<DividendRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("dividends")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })

  if (error) throw error
  // PostgREST serialises numeric as a JSON number, but coerce defensively — a string reaching the
  // engine would turn every sum into string concatenation.
  return (data ?? []).map((row) => ({
    ...row,
    shares: Number(row.shares),
    dividend_per_share: Number(row.dividend_per_share),
    tax: Number(row.tax),
    fee: Number(row.fee),
  }))
}

export function toDomainDividends(rows: readonly DividendRow[]): DomainDividend[] {
  return rows.map((row) => ({
    symbol: row.symbol,
    currency: baseCurrencyOf(row.currency),
    paidOn: row.payment_date.slice(0, 10),
    shares: row.shares,
    dividendPerShare: row.dividend_per_share,
    tax: row.tax,
    fee: row.fee,
  }))
}

export async function listDividendsPage(
  portfolioId: string,
  page: number,
  pageSize = PAGE_SIZE,
): Promise<Page<DividendRow>> {
  const supabase = await createClient()
  const { from, to } = pageRange(page, pageSize)
  const { data, error, count } = await supabase
    .from("dividends")
    .select("*", { count: "exact" })
    .eq("portfolio_id", portfolioId)
    .order("payment_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) throw error
  const rows = (data ?? []).map((row) => ({
    ...row,
    shares: Number(row.shares),
    dividend_per_share: Number(row.dividend_per_share),
    tax: Number(row.tax),
    fee: Number(row.fee),
  }))
  return toPageResult(rows, count ?? rows.length, page, pageSize)
}
