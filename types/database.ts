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
  /**
   * How this row came to exist. 'MANUAL' for everything typed in, which is most of them.
   * A reconciliation adjustment, a transferred row and a corporate-action row all say so, so an
   * unexpected transaction can always be traced without reading an audit trail first.
   */
  source: FinancialSource
  source_reference: string | null
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

/** Mirrors `CASH_FLOW_KINDS` in `domain/cash.ts`, which is where direction and meaning live. */
export type CashTransactionKind = import("@/domain/cash").CashFlowKind

export type CashTransactionRow = {
  id: string
  portfolio_id: string
  user_id: string
  kind: CashTransactionKind
  amount: number
  currency: string
  occurred_on: string
  notes: string | null
  source: FinancialSource
  source_reference: string | null
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

/** Phase 18 adds "news". Extended rather than paralleled: one preference table, one badge, one centre. */
export type NotificationCategory = "price" | "portfolio" | "dividend" | "system" | "news"

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
  /** Opt-in, unlike the others. See the migration comment. */
  news: boolean
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
  /** UI language. Presentation only; never derived from, and never deriving, currency or timezone. */
  locale: "th" | "en"
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

/**
 * Company-reported figures. **No `user_id`**: reference data about a company, never an input to a
 * portfolio calculation. Every figure is nullable — a partial statement is the normal case.
 */
export type FinancialStatementRow = {
  symbol: string
  market: string
  period_type: "ANNUAL" | "QUARTERLY"
  fiscal_year: number
  fiscal_quarter: number | null
  period_end: string
  report_date: string | null
  /** What the company reports in — not the market's currency and not the portfolio's. */
  currency: string
  revenue: number | null
  gross_profit: number | null
  operating_income: number | null
  ebitda: number | null
  net_income: number | null
  eps: number | null
  eps_diluted: number | null
  shares_diluted: number | null
  total_assets: number | null
  total_liabilities: number | null
  total_equity: number | null
  cash_and_equivalents: number | null
  total_debt: number | null
  current_assets: number | null
  current_liabilities: number | null
  operating_cash_flow: number | null
  capital_expenditure: number | null
  investing_cash_flow: number | null
  financing_cash_flow: number | null
  dividends_paid: number | null
  source: string
  fetched_at: string
  calculation_version: number
}

/** A notice about what a company is doing. An event never becomes a transaction. */
export type CorporateEventRow = {
  id: string
  symbol: string
  market: string
  event_type: string
  event_date: string | null
  /** Whether the provider's date is an estimate. Surfaced on every occurrence in the UI. */
  estimated: boolean
  title: string
  detail: string | null
  amount_per_share: number | null
  currency: string | null
  ratio: string | null
  source: string
  fetched_at: string
}

/**
 * Article **metadata**. No `user_id` and no article body: news is context about the world, never a
 * fact about a user, and a body is somebody else's copyrighted work.
 */
export type NewsArticleRow = {
  /** Primary key and idempotency guarantee — see `domain/news.ts:dedupeKeyFor`. */
  dedupe_key: string
  title: string
  /** The provider's own summary. Null when they supplied none; Stockly never writes one. */
  summary: string | null
  url: string
  source: string
  /** When the publication published it. */
  published_at: string
  /** When Stockly fetched it. A different fact. */
  fetched_at: string
  language: string | null
  market: string | null
  category: string
  sentiment: string
  sentiment_method: string
  provider: string
  created_at: string
}

export type NewsArticleSymbolRow = {
  dedupe_key: string
  symbol: string
  market: string
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
        Insert: Omit<
          TransactionRow,
          | "id"
          | Timestamps
          | "import_fingerprint"
          | "import_session_id"
          | "source_row"
          | "source"
          | "source_reference"
        > & {
          id?: string
          import_fingerprint?: string | null
          import_session_id?: string | null
          source_row?: number | null
          // Defaults to 'MANUAL' in the database, so a row written the way phase 1 wrote it still
          // compiles and still behaves identically.
          source?: FinancialSource
          source_reference?: string | null
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
        Insert: Omit<CashTransactionRow, "id" | Timestamps | "source" | "source_reference"> & {
          id?: string
          source?: FinancialSource
          source_reference?: string | null
        }
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
      news_articles: {
        Row: NewsArticleRow
        Insert: Omit<NewsArticleRow, "fetched_at" | "created_at"> & {
          fetched_at?: string
          created_at?: string
        }
        Update: Partial<Omit<NewsArticleRow, "dedupe_key">>
        Relationships: []
      }
      news_article_symbols: {
        Row: NewsArticleSymbolRow
        Insert: NewsArticleSymbolRow
        /** A link exists or it does not; there is nothing to edit. */
        Update: never
        Relationships: []
      }
      financial_statements: {
        Row: FinancialStatementRow
        Insert: Omit<FinancialStatementRow, "fetched_at" | "calculation_version"> & {
          fetched_at?: string
          calculation_version?: number
        }
        Update: Partial<Omit<FinancialStatementRow, "symbol" | "market" | "period_type" | "fiscal_year" | "fiscal_quarter">>
        Relationships: []
      }
      corporate_events: {
        Row: CorporateEventRow
        Insert: Omit<CorporateEventRow, "id" | "fetched_at" | "estimated"> & {
          id?: string
          fetched_at?: string
          estimated?: boolean
        }
        Update: Partial<Omit<CorporateEventRow, "id" | "symbol" | "market" | "event_type">>
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

      // ---------------------------------------------------------------- phase 19

      /**
       * Insert-only from the application's point of view, and not even that: the trigger writes it.
       * Declared here so a read can be typed, with no Insert or Update shape to hand anybody.
       */
      financial_audit: {
        Row: FinancialAuditRow
        Insert: never
        Update: never
        Relationships: []
      }
      share_adjustments: {
        Row: ShareAdjustmentRow
        Insert: Omit<ShareAdjustmentRow, "id" | Timestamps | "corporate_event_id" | "note"> & {
          id?: string
          corporate_event_id?: string | null
          note?: string | null
        }
        Update: Partial<Omit<ShareAdjustmentRow, "id" | "user_id" | "portfolio_id" | Timestamps>>
        Relationships: []
      }
      reconciliation_runs: {
        Row: ReconciliationRunRow
        Insert: Omit<
          ReconciliationRunRow,
          "id" | "created_at" | "started_at" | "completed_at" | "summary" | "status" | "error"
        > & {
          id?: string
          started_at?: string
          completed_at?: string | null
          summary?: Record<string, unknown>
          status?: ReconciliationRunRow["status"]
          error?: string | null
        }
        Update: Partial<Omit<ReconciliationRunRow, "id" | "user_id" | "portfolio_id" | "created_at">>
        Relationships: []
      }
      reconciliation_items: {
        Row: ReconciliationItemRow
        Insert: Omit<ReconciliationItemRow, "id" | "created_at" | "resolved_at" | "resolution"> & {
          id?: string
          resolved_at?: string | null
          resolution?: ReconciliationItemRow["resolution"]
        }
        Update: Partial<Pick<ReconciliationItemRow, "resolved_at" | "resolution">>
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
      /**
       * A correction, and a transfer. Both are `security definer` and both check `auth.uid()`
       * themselves — with RLS off inside them, that predicate is the ownership boundary.
       */
      correct_transaction: {
        Args: {
          p_id: string
          p_symbol: string
          p_market: string
          p_side: TransactionSide
          p_trade_date: string
          p_quantity: number
          p_price: number
          p_fee: number
          p_notes: string | null
          p_reason: string
        }
        Returns: TransactionRow
      }
      transfer_instrument: {
        Args: {
          p_from_portfolio: string
          p_to_portfolio: string
          p_symbol: string | null
          p_market: string | null
          p_reason: string
        }
        Returns: number
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

// ---------------------------------------------------------------- phase 19: portfolio operations

/** Where a money-bearing row came from. Written on the row itself, not inferred from a join. */
export type FinancialSource =
  | "MANUAL"
  | "IMPORT"
  | "RECONCILIATION"
  | "TRANSFER"
  | "CORPORATE_ACTION"

/**
 * One change to a money-bearing row, written by a database trigger.
 *
 * Readable by its owner and writable by nobody: the table has no insert, update or delete policy,
 * and the trigger writes through `security definer`.
 */
export type FinancialAuditRow = {
  id: string
  user_id: string
  /** Not a foreign key — an audit row outlives the row it describes. */
  portfolio_id: string | null
  entity: "TRANSACTION" | "CASH_TRANSACTION"
  entity_id: string
  operation: "INSERT" | "UPDATE" | "DELETE"
  /** The whole row, before and after. Null on an insert and a delete respectively. */
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  /** Set by a correction or a transfer; null for an ordinary edit, which is honest. */
  reason: string | null
  source: FinancialSource | "CORRECTION"
  occurred_at: string
}

/** A split the user confirmed. Applied in front of the engine; transactions are never rewritten. */
export type ShareAdjustmentRow = {
  id: string
  portfolio_id: string
  user_id: string
  symbol: string
  market: string
  event_type: "SPLIT" | "REVERSE_SPLIT"
  effective_date: string
  numerator: number
  denominator: number
  corporate_event_id: string | null
  note: string | null
  created_at: string
  updated_at: string
}

export type ReconciliationRunRow = {
  id: string
  portfolio_id: string
  user_id: string
  /** Which statement this was. Free text rather than a broker-account foreign key — see the migration. */
  source_label: string
  period_start: string | null
  period_end: string | null
  status: import("@/domain/reconciliation").ReconciliationStatus
  /** Counts only. Every figure the report shows is re-derived, so a run cannot go stale. */
  summary: Record<string, unknown>
  started_at: string
  completed_at: string | null
  error: string | null
  created_at: string
}

export type ReconciliationItemRow = {
  id: string
  run_id: string
  user_id: string
  scope: import("@/domain/reconciliation").ReconciliationScope
  status: string
  symbol: string | null
  market: string | null
  currency: string | null
  /** A pointer, not a reference: the finding stays readable after the transaction is deleted. */
  transaction_id: string | null
  detail: Record<string, unknown>
  resolved_at: string | null
  resolution: "ADJUSTED" | "IGNORED" | "EXPLAINED" | null
  created_at: string
}
