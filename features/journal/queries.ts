import "server-only"

import { symbolKey, toMarket, type MarketId } from "@/domain/market"
import { pageRange, toPageResult, type Page, PAGE_SIZE } from "@/lib/pagination"
import { createClient } from "@/lib/supabase/server"
import type { JournalRow } from "@/types/database"
import type { z } from "zod"
import type { journalFilterSchema } from "./schema"

export type JournalFilter = z.output<typeof journalFilterSchema>

/**
 * One page of journal entries, newest first.
 *
 * Filtering happens in Postgres rather than in JavaScript: a journal grows without bound, and
 * fetching every entry to filter five of them is the pagination mistake CLAUDE.md exists to
 * prevent. `q` uses `ilike` across title and content — good enough for a personal journal, and
 * cheap; full-text search would need a tsvector column nobody has asked for.
 *
 * RLS scopes every read to the caller, so a `portfolioId` belonging to someone else simply returns
 * nothing rather than an error that would confirm the portfolio exists.
 */
export async function listJournalPage(
  filter: JournalFilter,
  page = 1,
  pageSize = PAGE_SIZE,
): Promise<Page<JournalRow>> {
  const supabase = await createClient()
  const { from, to } = pageRange(page, pageSize)

  let query = supabase
    .from("investment_journals")
    .select("*", { count: "exact" })
    .eq("portfolio_id", filter.portfolioId)

  // Applied inline rather than through a helper: PostgREST's builder returns a differently-typed
  // object from every call, and the generic needed to abstract that costs more than it saves.
  if (filter.type) query = query.eq("type", filter.type)
  if (filter.symbol) query = query.eq("symbol", filter.symbol)
  if (filter.market) query = query.eq("market", filter.market)
  if (filter.from) query = query.gte("entry_date", filter.from)
  if (filter.to) query = query.lte("entry_date", filter.to)
  if (filter.q) query = query.or(searchFilter(filter.q))

  const { data, error, count } = await query
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .range(from, to)

  if (error) throw error
  const rows = data ?? []
  return toPageResult(rows, count ?? rows.length, page, pageSize)
}

/** Entries for one instrument, for the position page. Capped: a timeline lives on its own page. */
export async function listJournalForInstrument(
  portfolioId: string,
  symbol: string,
  market: MarketId,
  limit = 5,
): Promise<JournalRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("investment_journals")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .eq("symbol", symbol)
    .eq("market", market)
    .order("entry_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit)

  if (error) throw error
  return data ?? []
}

/**
 * Sell reviews for a portfolio, keyed by transaction id.
 *
 * One query for the whole page rather than one per closed trade — the N+1 this would otherwise be
 * is exactly the shape phase 8 went hunting for.
 */
export async function sellReviewsByTransaction(
  portfolioId: string,
): Promise<Map<string, JournalRow>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("investment_journals")
    .select("*")
    .eq("portfolio_id", portfolioId)
    .eq("type", "SELL_REASON")
    .not("transaction_id", "is", null)

  if (error) throw error
  return new Map((data ?? []).map((row) => [row.transaction_id as string, row]))
}

/** The instruments a portfolio has written about, for the timeline's filter dropdown. */
export async function journalInstruments(
  portfolioId: string,
): Promise<Array<{ symbol: string; market: MarketId }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("investment_journals")
    .select("symbol, market")
    .eq("portfolio_id", portfolioId)
    .not("symbol", "is", null)

  if (error) throw error
  const seen = new Map<string, { symbol: string; market: MarketId }>()
  for (const row of data ?? []) {
    if (!row.symbol) continue
    const market = toMarket(row.market)
    seen.set(symbolKey(row.symbol, market), { symbol: row.symbol, market })
  }
  return [...seen.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))
}

/**
 * A free-text search across title and content.
 *
 * The escaping is the security-relevant part: a comma, a parenthesis or a backslash in the search
 * box is PostgREST filter syntax, and an unescaped one would let a query string reshape the filter
 * rather than being searched for. `%` is escaped too, so a literal percent sign does not silently
 * become a wildcard.
 */
function searchFilter(term: string): string {
  const escaped = term.replace(/[%,()\\]/g, (match) => `\\${match}`)
  return `title.ilike.%${escaped}%,content.ilike.%${escaped}%`
}

export type { JournalRow }
