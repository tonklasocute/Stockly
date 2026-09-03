/**
 * Hand-written until a Supabase project exists. Regenerate with:
 *   npx supabase gen types typescript --local > types/database.ts
 */
export type TransactionSide = "buy" | "sell"

export type PortfolioRow = {
  id: string
  user_id: string
  name: string
  /** The **base currency**: what every total on this portfolio's pages is denominated in. */
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
  /**
   * Import provenance, all null for a transaction entered by hand.
   *
   * `import_fingerprint` is the idempotency key, unique per user — the database is what makes
   * re-importing the same file create nothing, rather than a check that two concurrent requests
   * could both pass.
   */
  import_fingerprint: string | null
  import_session_id: string | null
  source_row: number | null
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
  /** Manual position. Null means "unordered", which is how every row read before phase 15. */
  sort_order: number | null
  pinned: boolean
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
  /**
   * The base currency this row was recorded in. The performance chart reads only the rows matching
   * the portfolio's current base currency — a series that mixed two units would show a cliff on the
   * day the setting changed and call it performance.
   */
  currency: string
  total_value: number
  invested_value: number
  cash_value: number
  realized_pnl: number
  unrealized_pnl: number
  /**
   * How much of this reading Stockly stands behind. A PARTIAL row carries a value **and**
   * `missing_holdings`, because a total that quietly excluded two positions looks exactly like one
   * that included them.
   */
  quality: SnapshotQuality
  /** The engine version that produced it, so an old row is never reinterpreted under new rules. */
  calculation_version: number
  missing_holdings: number
  /** Whether the scheduled close job wrote it, or somebody happening to open the analytics page. */
  source: SnapshotSource
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

export type AIConversationRow = {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export type AIMessageRole = "user" | "assistant"

export type AIMessageRow = {
  id: string
  conversation_id: string
  user_id: string
  role: AIMessageRole
  content: string
  /** The grounded payload the UI renders as cards. Null for user turns. */
  data: unknown
  intent: string | null
  symbols: string[]
  created_at: string
}

export type AIUsageRow = {
  id: string
  user_id: string
  provider: string
  model: string
  intent: string | null
  symbols: string[]
  input_tokens: number
  output_tokens: number
  estimated_cost: number | null
  latency_ms: number | null
  status: "ok" | "error"
  error_code: string | null
  created_at: string
}

// ---------------------------------------------------------------- phase 10: intelligence
//
// None of these rows carries a financial result. Progress, returns and P&L are derived from
// transactions and market data on every request — see supabase/migrations/20260903000000.

export type JournalType =
  | "BUY_THESIS"
  | "SELL_REASON"
  | "POSITION_REVIEW"
  | "MARKET_NOTE"
  | "DIVIDEND_NOTE"
  | "GENERAL"

export type SellReason =
  | "TARGET_REACHED"
  | "THESIS_BROKEN"
  | "RISK_INCREASED"
  | "VALUATION"
  | "PORTFOLIO_REBALANCE"
  | "LIQUIDITY"
  | "TAX"
  | "OTHER"

export type ThesisStatus = "ACTIVE" | "CONFIRMED" | "QUESTIONED" | "BROKEN" | "CLOSED"

export type GoalType = "PORTFOLIO_VALUE" | "INVESTED_CAPITAL" | "DIVIDEND_INCOME" | "TOTAL_RETURN"

export type JournalRow = {
  id: string
  portfolio_id: string
  user_id: string
  /** Null for an entry that belongs to no single instrument, such as a market note. */
  symbol: string | null
  market: string
  transaction_id: string | null
  type: JournalType
  /** Only ever set on a SELL_REASON entry; a check constraint enforces it. */
  reason: SellReason | null
  title: string
  content: string
  entry_date: string
  created_at: string
  updated_at: string
}

export type ThesisRow = {
  id: string
  portfolio_id: string
  user_id: string
  symbol: string
  market: string
  title: string
  why_bought: string
  expectations: string
  catalysts: string
  risks: string
  invalidation_criteria: string
  conviction: number
  /** Set by the user, never by the system. */
  status: ThesisStatus
  created_at: string
  updated_at: string
}

export type PortfolioGoalRow = {
  id: string
  portfolio_id: string
  user_id: string
  type: GoalType
  /** Money for value/capital/income goals, a percentage for TOTAL_RETURN. `type` says which. */
  target_value: number
  /** Null exactly when the target is a percentage. */
  currency: string | null
  target_date: string | null
  note: string | null
  created_at: string
  updated_at: string
}

/** Shared reference data: no user_id, readable by everyone signed in, writable by nobody. */
export type BenchmarkRow = {
  id: string
  code: string
  name: string
  symbol: string
  market: string
  currency: string
  created_at: string
}

export type PortfolioBenchmarkRow = {
  id: string
  portfolio_id: string
  user_id: string
  benchmark_id: string
  created_at: string
}

// ---------------------------------------------------------------- phase 11: simulation

export type SimulationType = "COMPOUND_GROWTH" | "DCA" | "GOAL" | "DIVIDEND" | "WHAT_IF"

/**
 * A saved scenario: **inputs only, never results.**
 *
 * Everything a simulation produces is recomputed from `inputs` on every read by the same pure
 * functions that produced it the first time — so a saved scenario cannot go stale, and can never be
 * mistaken for a record of something that happened.
 */
export type SavedSimulationRow = {
  id: string
  user_id: string
  /** Null for a scenario that needs no portfolio, such as a bare compound-growth calculation. */
  portfolio_id: string | null
  name: string
  type: SimulationType
  /** The assumptions as the user typed them. Validated by Zod at the boundary. */
  inputs: unknown
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------- phase 12: import & automation

/** A session records an import that was applied; a preview writes nothing and has no row. */
export type ImportStatus = "APPLIED" | "PARTIAL" | "FAILED"
export type ImportFormat = "CSV" | "XLSX"

/** One upload. The file itself is never stored — only what was read out of it. */
export type ImportSessionRow = {
  id: string
  user_id: string
  portfolio_id: string
  filename: string
  format: ImportFormat
  status: ImportStatus
  /** The column mapping the user confirmed, so history explains how the file was read. */
  mapping: unknown
  total_rows: number
  create_count: number
  duplicate_count: number
  reject_count: number
  applied_count: number
  applied_at: string
  error: string | null
  created_at: string
  updated_at: string
}

/** Only rows that did NOT become transactions; a created one is a transaction carrying its id. */
export type ImportRowRow = {
  id: string
  session_id: string
  user_id: string
  row_number: number
  outcome: "DUPLICATE" | "REJECT"
  issues: unknown
  values: unknown
  created_at: string
}

/** Deployment-wide operational history. Counters only, never a provider payload. */
export type JobExecutionRow = {
  id: string
  job: string
  started_at: string
  completed_at: string | null
  status: "RUNNING" | "OK" | "PARTIAL" | "FAILED"
  processed: number
  succeeded: number
  failed: number
  error_summary: string | null
}

export type UserPreferencesRow = {
  user_id: string
  theme: "system" | "light" | "dark"
  density: "comfortable" | "compact"
  default_portfolio_id: string | null
  /** Five documents rather than five tables — see the migration's header for why. */
  favorite_metrics: unknown
  dashboard_layout: unknown
  dismissed_insights: unknown
  pinned_items: unknown
  recent_items: unknown
  created_at: string
  updated_at: string
}

export type TagRow = {
  id: string
  user_id: string
  name: string
  color: string
  created_at: string
  updated_at: string
}

/**
 * A tag applied to an instrument inside one portfolio.
 *
 * Keyed by `(portfolio_id, market, symbol)` and never by a holding id: a holding is derived from
 * transactions, not stored, and giving one an id is the first step towards a second source of truth.
 */
export type HoldingTagRow = {
  id: string
  user_id: string
  portfolio_id: string
  tag_id: string
  market: string
  symbol: string
  created_at: string
}

/** A filter, a sort, columns and a grouping. Holds no figure, so it cannot go stale. */
export type SavedViewRow = {
  id: string
  user_id: string
  portfolio_id: string | null
  name: string
  config: unknown
  created_at: string
  updated_at: string
}

/** Daily exchange rates. Shared reference data: no user_id, readable by anyone signed in. */
export type FxRateDailyRow = {
  base: string
  quote: string
  rate_date: string
  rate: number
  source: "PROVIDER" | "MANUAL"
  created_at: string
}

export type SnapshotQuality = "COMPLETE" | "PARTIAL" | "STALE"
export type SnapshotSource = "PAGE_VIEW" | "SCHEDULED" | "BACKFILL"

export type ShareVisibility = "PRIVATE" | "LINK_ONLY" | "PUBLIC"

export type PortfolioShareRow = {
  id: string
  portfolio_id: string
  user_id: string
  visibility: ShareVisibility
  slug: string | null
  display_name: string | null
  description: string | null
  owner_display_name: string | null
  show_overview: boolean
  show_holdings: boolean
  show_allocation: boolean
  show_performance: boolean
  show_risk: boolean
  show_dividends: boolean
  show_benchmark: boolean
  show_insights: boolean
  show_goals: boolean
  show_absolute_values: boolean
  show_quantity: boolean
  show_unrealized_pnl: boolean
  show_realized_pnl: boolean
  show_cash: boolean
  allow_search_indexing: boolean
  settings_version: number
  created_at: string
  updated_at: string
}

/**
 * The published projection. `payload` is a `PublicPortfolio` document — already filtered by the
 * owner's settings before it was written, which is why an anonymous role may read this table and
 * no other.
 */
export type PublishedShareRow = {
  portfolio_id: string
  slug: string
  visibility: Exclude<ShareVisibility, "PRIVATE">
  /** Denormalised from portfolio_shares: the anonymous role cannot read that table. */
  allow_search_indexing: boolean
  payload: unknown
  settings_version: number
  published_at: string
}

export type PortfolioShareLinkRow = {
  id: string
  portfolio_id: string
  user_id: string
  /** SHA-256 hex. The raw token is never stored. */
  token_hash: string
  label: string | null
  expires_at: string | null
  revoked_at: string | null
  access_count: number
  last_accessed_at: string | null
  created_at: string
}

/** Immutable. Distinct from `portfolio_snapshots`, which is the daily value series. */
export type ShareSnapshotRow = {
  id: string
  portfolio_id: string
  user_id: string
  token_hash: string
  version: number
  label: string | null
  base_currency: string
  calculated_at: string
  payload: unknown
  created_at: string
}

export type ShareEventAction =
  | "VISIBILITY_CHANGED"
  | "SETTINGS_CHANGED"
  | "PUBLISHED"
  | "UNPUBLISHED"
  | "LINK_CREATED"
  | "LINK_REVOKED"
  | "SNAPSHOT_CREATED"
  | "SNAPSHOT_DELETED"

export type ShareEventRow = {
  id: string
  portfolio_id: string
  user_id: string
  action: ShareEventAction
  detail: Record<string, unknown>
  created_at: string
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
        // Import provenance is optional on insert: a hand-entered transaction has none, which is
        // exactly what makes "where did this come from?" answerable.
        Insert: Omit<TransactionRow, "id" | Timestamps | "import_fingerprint" | "import_session_id" | "source_row"> & {
          id?: string
          import_fingerprint?: string | null
          import_session_id?: string | null
          source_row?: number | null
        }
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
        // The provenance columns all default in the database, so a row written the way phase 3
        // wrote it still compiles and still behaves identically.
        Insert: Omit<
          PortfolioSnapshotRow,
          "id" | Timestamps | "quality" | "calculation_version" | "missing_holdings" | "source"
        > & {
          id?: string
          quality?: SnapshotQuality
          calculation_version?: number
          missing_holdings?: number
          source?: SnapshotSource
        }
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
      ai_conversations: {
        Row: AIConversationRow
        Insert: Omit<AIConversationRow, "id" | Timestamps> & { id?: string }
        // updated_at is settable: touching a conversation is how the history list stays ordered.
        Update: Partial<Omit<AIConversationRow, "id" | "user_id" | "created_at">>
        Relationships: []
      }
      ai_messages: {
        Row: AIMessageRow
        Insert: Omit<AIMessageRow, "id" | "created_at"> & { id?: string }
        Update: never
        Relationships: []
      }
      ai_usage: {
        Row: AIUsageRow
        Insert: Omit<AIUsageRow, "id" | "created_at"> & { id?: string }
        Update: never
        Relationships: []
      }
      investment_journals: {
        Row: JournalRow
        Insert: Omit<JournalRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<JournalRow, "id" | "user_id" | "portfolio_id" | Timestamps>>
        Relationships: []
      }
      investment_theses: {
        Row: ThesisRow
        Insert: Omit<ThesisRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<ThesisRow, "id" | "user_id" | "portfolio_id" | Timestamps>>
        Relationships: []
      }
      portfolio_goals: {
        Row: PortfolioGoalRow
        Insert: Omit<PortfolioGoalRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Omit<PortfolioGoalRow, "id" | "user_id" | "portfolio_id" | Timestamps>>
        Relationships: []
      }
      benchmarks: {
        Row: BenchmarkRow
        // Reference data. RLS grants select only, so these exist for the type checker alone.
        Insert: never
        Update: never
        Relationships: []
      }
      portfolio_benchmarks: {
        Row: PortfolioBenchmarkRow
        Insert: Omit<PortfolioBenchmarkRow, "id" | "created_at"> & { id?: string }
        Update: Partial<Pick<PortfolioBenchmarkRow, "benchmark_id">>
        Relationships: []
      }
      import_sessions: {
        Row: ImportSessionRow
        // `error` and `applied_at` have defaults; the counts do too, but the apply path sets them.
        Insert: Omit<ImportSessionRow, "id" | Timestamps | "error" | "applied_at"> & {
          id?: string
          error?: string | null
          applied_at?: string
        }
        Update: Partial<Omit<ImportSessionRow, "id" | "user_id" | "portfolio_id" | Timestamps>>
        Relationships: []
      }
      import_rows: {
        Row: ImportRowRow
        Insert: Omit<ImportRowRow, "id" | "created_at"> & { id?: string }
        Update: never
        Relationships: []
      }
      job_executions: {
        Row: JobExecutionRow
        // Everything but the job name has a default; a run is opened with the name alone.
        Insert: Pick<JobExecutionRow, "job"> &
          Partial<Omit<JobExecutionRow, "id" | "job">> & { id?: string }
        Update: Partial<Omit<JobExecutionRow, "id" | "job">>
        Relationships: []
      }
      saved_simulations: {
        Row: SavedSimulationRow
        Insert: Omit<SavedSimulationRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Pick<SavedSimulationRow, "name" | "inputs">>
        Relationships: []
      }
      portfolio_shares: {
        Row: PortfolioShareRow
        // Every flag has a database default of false, so a row can be created from the ids alone.
        Insert: Pick<PortfolioShareRow, "portfolio_id" | "user_id"> &
          Partial<Omit<PortfolioShareRow, "id" | "portfolio_id" | "user_id" | Timestamps>> & { id?: string }
        Update: Partial<Omit<PortfolioShareRow, "id" | "portfolio_id" | "user_id" | Timestamps>>
        Relationships: []
      }
      published_shares: {
        Row: PublishedShareRow
        Insert: Omit<PublishedShareRow, "published_at"> & { published_at?: string }
        Update: Partial<Omit<PublishedShareRow, "portfolio_id">>
        Relationships: []
      }
      portfolio_share_links: {
        Row: PortfolioShareLinkRow
        Insert: Pick<PortfolioShareLinkRow, "portfolio_id" | "user_id" | "token_hash"> &
          Partial<Omit<PortfolioShareLinkRow, "id" | "portfolio_id" | "user_id" | "token_hash" | "created_at">> & {
            id?: string
          }
        // Revocation only. The token hash and the portfolio it belongs to are never rewritten.
        Update: Partial<Pick<PortfolioShareLinkRow, "revoked_at" | "label">>
        Relationships: []
      }
      share_snapshots: {
        Row: ShareSnapshotRow
        Insert: Omit<ShareSnapshotRow, "id" | "created_at" | "version"> & { id?: string; version?: number }
        /** Immutable: there is no update policy on the table, so there is no update type here. */
        Update: never
        Relationships: []
      }
      share_events: {
        Row: ShareEventRow
        Insert: Omit<ShareEventRow, "id" | "created_at" | "detail"> & {
          id?: string
          detail?: Record<string, unknown>
        }
        Update: never
        Relationships: []
      }
      user_preferences: {
        Row: UserPreferencesRow
        // Every column has a default, so a row can be created from the user id alone.
        Insert: Pick<UserPreferencesRow, "user_id"> &
          Partial<Omit<UserPreferencesRow, "user_id" | Timestamps>>
        Update: Partial<Omit<UserPreferencesRow, "user_id" | Timestamps>>
        Relationships: []
      }
      tags: {
        Row: TagRow
        Insert: Omit<TagRow, "id" | Timestamps | "color"> & { id?: string; color?: string }
        Update: Partial<Pick<TagRow, "name" | "color">>
        Relationships: []
      }
      holding_tags: {
        Row: HoldingTagRow
        Insert: Omit<HoldingTagRow, "id" | "created_at"> & { id?: string }
        /** An assignment is created or removed, never edited. */
        Update: never
        Relationships: []
      }
      saved_views: {
        Row: SavedViewRow
        Insert: Omit<SavedViewRow, "id" | Timestamps> & { id?: string }
        Update: Partial<Pick<SavedViewRow, "name" | "config" | "portfolio_id">>
        Relationships: []
      }
      fx_rates_daily: {
        Row: FxRateDailyRow
        Insert: Omit<FxRateDailyRow, "created_at" | "source"> & { source?: FxRateDailyRow["source"] }
        /** Reference data written only by the scheduled job; a correction is a new row, not an edit. */
        Update: never
        Relationships: []
      }
      watchlist_items: {
        Row: WatchlistItemRow
        // `sort_order` and `pinned` are optional: both default in the database, so a row added the
        // way it always was still compiles and still behaves the way it always did.
        Insert: Omit<WatchlistItemRow, "id" | Timestamps | "sort_order" | "pinned"> & {
          id?: string
          sort_order?: number | null
          pinned?: boolean
        }
        Update: Partial<Omit<WatchlistItemRow, "id" | "user_id" | Timestamps>>
        Relationships: []
      }
    }
    Views: Record<string, never>
    /**
     * Token-gated reads. Both are `security definer`, so an anonymous caller can present a token
     * without being granted any select on the tables behind them.
     */
    Functions: {
      share_by_token: {
        Args: { p_token_hash: string }
        Returns: Array<{ payload: unknown; published_at: string; visibility: ShareVisibility }>
      }
      snapshot_by_token: {
        Args: { p_token_hash: string }
        Returns: Array<{
          payload: unknown
          version: number
          label: string | null
          calculated_at: string
          created_at: string
        }>
      }
    }
    Enums: {
      transaction_side: TransactionSide
      cash_transaction_kind: CashTransactionKind
      alert_type: AlertType
      alert_state: AlertState
      notification_category: NotificationCategory
      journal_type: JournalType
      sell_reason: SellReason
      thesis_status: ThesisStatus
      goal_type: GoalType
      simulation_type: SimulationType
      import_status: ImportStatus
      import_format: ImportFormat
      share_visibility: ShareVisibility
    }
    CompositeTypes: Record<string, never>
  }
}
