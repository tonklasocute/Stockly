/**
 * Hand-written until a Supabase project exists. Regenerate with:
 *   npx supabase gen types typescript --local > types/database.ts
 */
export type TransactionSide = "buy" | "sell"

export type PortfolioRow = {
  id: string
  user_id: string
  name: string
  currency: string
  created_at: string
  updated_at: string
}

export type TransactionRow = {
  id: string
  portfolio_id: string
  user_id: string
  symbol: string
  market: string
  side: TransactionSide
  trade_date: string
  quantity: number
  price: number
  fee: number
  notes: string | null
  created_at: string
  updated_at: string
}

export type WatchlistItemRow = {
  id: string
  user_id: string
  symbol: string
  market: string
  name: string | null
  exchange: string | null
  target_price: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type DividendRow = {
  id: string
  portfolio_id: string
  user_id: string
  symbol: string
  market: string
  payment_date: string
  shares: number
  dividend_per_share: number
  tax: number
  fee: number
  currency: string
  notes: string | null
  created_at: string
  updated_at: string
}

export type CashTransactionKind = "deposit" | "withdrawal"

export type CashTransactionRow = {
  id: string
  portfolio_id: string
  user_id: string
  kind: CashTransactionKind
  amount: number
  currency: string
  occurred_on: string
  notes: string | null
  created_at: string
  updated_at: string
}

export type PortfolioSnapshotRow = {
  id: string
  portfolio_id: string
  user_id: string
  snapshot_date: string
  total_value: number
  invested_value: number
  cash_value: number
  realized_pnl: number
  unrealized_pnl: number
  created_at: string
  updated_at: string
}

export type ProfileRow = {
  id: string
  display_name: string | null
  created_at: string
  updated_at: string
}

type Timestamps = "created_at" | "updated_at"

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow
        Insert: Partial<Omit<ProfileRow, "id">> & { id: string }
        Update: Partial<Omit<ProfileRow, "id">>
        Relationships: []
      }
      portfolios: {
        Row: PortfolioRow
        Insert: Omit<PortfolioRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<PortfolioRow, "id" | "user_id" | Timestamps>>
        Relationships: []
      }
      transactions: {
        Row: TransactionRow
        Insert: Omit<TransactionRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<TransactionRow, "id" | "user_id" | "portfolio_id" | Timestamps>>
        Relationships: []
      }
      dividends: {
        Row: DividendRow
        Insert: Omit<DividendRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<DividendRow, "id" | "user_id" | "portfolio_id" | Timestamps>>
        Relationships: []
      }
      cash_transactions: {
        Row: CashTransactionRow
        Insert: Omit<CashTransactionRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<CashTransactionRow, "id" | "user_id" | "portfolio_id" | Timestamps>>
        Relationships: []
      }
      portfolio_snapshots: {
        Row: PortfolioSnapshotRow
        Insert: Omit<PortfolioSnapshotRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<PortfolioSnapshotRow, "id" | "user_id" | "portfolio_id" | Timestamps>>
        Relationships: []
      }
      watchlist_items: {
        Row: WatchlistItemRow
        Insert: Omit<WatchlistItemRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<WatchlistItemRow, "id" | "user_id" | Timestamps>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: { transaction_side: TransactionSide; cash_transaction_kind: CashTransactionKind }
    CompositeTypes: Record<string, never>
  }
}
