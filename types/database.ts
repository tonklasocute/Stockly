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

export type AlertType =
  | "PRICE_ABOVE"
  | "PRICE_BELOW"
  | "PERCENT_CHANGE_ABOVE"
  | "PERCENT_CHANGE_BELOW"
  | "PORTFOLIO_DAILY_CHANGE_ABOVE"
  | "PORTFOLIO_DAILY_CHANGE_BELOW"
  | "PORTFOLIO_TOTAL_RETURN_ABOVE"
  | "PORTFOLIO_TOTAL_RETURN_BELOW"
  | "POSITION_WEIGHT_ABOVE"
  | "POSITION_WEIGHT_BELOW"
  | "DIVIDEND_RECEIVED"
  | "RSI_ABOVE"
  | "RSI_BELOW"
  | "MACD_BULLISH_CROSS"
  | "MACD_BEARISH_CROSS"
  | "PRICE_ABOVE_EMA"
  | "PRICE_BELOW_EMA"
  | "EMA_CROSS_BULLISH"
  | "EMA_CROSS_BEARISH"
  | "RELATIVE_VOLUME_ABOVE"
  | "ADX_ABOVE"

export type AlertState = "armed" | "triggered" | "cooldown"

export type NotificationCategory = "price" | "portfolio" | "dividend" | "system"

export type AlertRow = {
  id: string
  user_id: string
  portfolio_id: string | null
  symbol: string | null
  market: string
  type: AlertType
  target_value: number
  enabled: boolean
  state: AlertState
  last_value: number | null
  last_evaluated_at: string | null
  last_triggered_at: string | null
  cooldown_minutes: number
  notes: string | null
  created_at: string
  updated_at: string
}

export type AlertEventRow = {
  id: string
  alert_id: string
  user_id: string
  triggered_at: string
  trigger_value: number
  reference_value: number
  message: string
  idempotency_key: string
  created_at: string
}

export type NotificationRow = {
  id: string
  user_id: string
  category: NotificationCategory
  title: string
  body: string
  href: string | null
  alert_id: string | null
  read_at: string | null
  created_at: string
}

export type NotificationPreferencesRow = {
  user_id: string
  price: boolean
  portfolio: boolean
  dividend: boolean
  system: boolean
  push: boolean
  created_at: string
  updated_at: string
}

export type PushSubscriptionRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  last_used_at: string | null
  created_at: string
  updated_at: string
}

export type TechnicalSnapshotRow = {
  symbol: string
  market: string
  timeframe: string
  source_timestamp: string | null
  calculated_at: string
  price: number | null
  rsi: number | null
  macd: number | null
  macd_signal: number | null
  macd_histogram: number | null
  macd_cross: "bullish" | "bearish" | null
  ema_cross_50_200: "bullish" | "bearish" | null
  adx: number | null
  plus_di: number | null
  minus_di: number | null
  atr: number | null
  atr_pct: number | null
  relative_volume: number | null
  average_volume: number | null
  ema_20: number | null
  ema_50: number | null
  ema_200: number | null
  sma_50: number | null
  sma_200: number | null
  bollinger_upper: number | null
  bollinger_middle: number | null
  bollinger_lower: number | null
  trend: "bullish" | "bearish" | "neutral" | null
  stage: string | null
  score: number | null
  score_version: string
  signals: string[]
  candle_count: number
  data_issues: string[]
}

export type SavedScreenRow = {
  id: string
  user_id: string
  name: string
  definition: unknown
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
      alerts: {
        Row: AlertRow
        Insert: Omit<AlertRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<AlertRow, "id" | "user_id" | Timestamps>>
        Relationships: []
      }
      alert_events: {
        Row: AlertEventRow
        Insert: Omit<AlertEventRow, "id" | "created_at"> & { id?: string; triggered_at?: string }
        Update: Partial<Omit<AlertEventRow, "id">>
        Relationships: []
      }
      notifications: {
        Row: NotificationRow
        Insert: Omit<NotificationRow, "id" | "created_at"> & { id?: string }
        Update: Partial<Pick<NotificationRow, "read_at">>
        Relationships: []
      }
      notification_preferences: {
        Row: NotificationPreferencesRow
        Insert: Partial<NotificationPreferencesRow> & { user_id: string }
        Update: Partial<Omit<NotificationPreferencesRow, "user_id" | Timestamps>>
        Relationships: []
      }
      push_subscriptions: {
        Row: PushSubscriptionRow
        Insert: Omit<PushSubscriptionRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<PushSubscriptionRow, "id" | "user_id" | Timestamps>>
        Relationships: []
      }
      technical_snapshots: {
        Row: TechnicalSnapshotRow
        Insert: TechnicalSnapshotRow
        Update: Partial<TechnicalSnapshotRow>
        Relationships: []
      }
      saved_screens: {
        Row: SavedScreenRow
        Insert: Omit<SavedScreenRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<SavedScreenRow, "id" | "user_id" | Timestamps>>
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
    Enums: {
      transaction_side: TransactionSide
      cash_transaction_kind: CashTransactionKind
      alert_type: AlertType
      alert_state: AlertState
      notification_category: NotificationCategory
    }
    CompositeTypes: Record<string, never>
  }
}
