-- Phase 17: company fundamentals and corporate events.
--
-- The rule this migration is built around:
--
--   **This is reference data about a COMPANY. A portfolio is a fact about a USER.**
--
-- Nothing here has a `user_id`, nothing here references `transactions`, and nothing here is an
-- input to a financial calculation. A thousand rows of fundamentals cannot move a holding, a cost
-- basis or a P&L figure — `domain/fundamentals-invariants.test.ts` asserts it, and the absence of
-- any user column is what makes it structurally true rather than merely observed.
--
-- Shared reference data, exactly like `technical_snapshots`, `benchmarks` and `fx_rates_daily`:
-- readable by any signed-in user, writable by nobody through a request.
--
-- Forward-only and additive.

-- ---------------------------------------------------------------- financial statements
--
-- One row per instrument per fiscal period. **Every figure is nullable**, deliberately: a provider
-- that covers US large caps well may return nothing at all for a SET small cap, and a partial
-- statement is the normal case rather than an error.
--
-- A null means "not reported to us". It is NOT zero — a company with no debt reports 0, and a
-- provider that does not cover its balance sheet reports nothing. Conflating them would turn a
-- coverage gap into a claim about the business.

create table public.financial_statements (
  symbol         text not null,
  market         text not null,
  -- 'ANNUAL' or 'QUARTERLY'. TTM is derived on read from four quarters and never stored: storing
  -- it would be a second answer that could disagree with the quarters it came from.
  period_type    text not null,
  fiscal_year    integer not null,
  -- 1-4 for a quarter, null for an annual period. A year is not a quarter of anything.
  fiscal_quarter integer,
  period_end     date not null,
  report_date    date,

  /*
   * The currency the COMPANY reports in — not the market's, and not the portfolio's.
   *
   * A company can report in a currency other than the one its shares trade in. Deriving this from
   * the market would silently turn every multiple into an exchange rate, which is exactly the case
   * `domain/valuation.ts` refuses to compute.
   */
  currency       text not null,

  -- Income statement.
  revenue           numeric(24, 4),
  gross_profit      numeric(24, 4),
  operating_income  numeric(24, 4),
  ebitda            numeric(24, 4),
  net_income        numeric(24, 4),
  eps               numeric(18, 6),
  eps_diluted       numeric(18, 6),
  shares_diluted    numeric(24, 4),

  -- Balance sheet.
  total_assets        numeric(24, 4),
  total_liabilities   numeric(24, 4),
  total_equity        numeric(24, 4),
  cash_and_equivalents numeric(24, 4),
  total_debt          numeric(24, 4),
  current_assets      numeric(24, 4),
  current_liabilities numeric(24, 4),

  -- Cash flow.
  operating_cash_flow  numeric(24, 4),
  capital_expenditure  numeric(24, 4),
  investing_cash_flow  numeric(24, 4),
  financing_cash_flow  numeric(24, 4),
  dividends_paid       numeric(24, 4),

  source              text not null,
  fetched_at          timestamptz not null default now(),
  calculation_version integer not null default 1,

  -- One row per instrument per period. This is what makes the refresh job idempotent: a second run
  -- upserts the same row rather than appending a second version of the same quarter.
  primary key (market, symbol, period_type, fiscal_year, fiscal_quarter),

  constraint financial_statements_period_type_known check (period_type in ('ANNUAL', 'QUARTERLY')),
  -- A quarter must name its quarter; an annual period must not.
  constraint financial_statements_quarter_agrees check (
    (period_type = 'QUARTERLY') = (fiscal_quarter is not null)
  ),
  constraint financial_statements_quarter_range check (
    fiscal_quarter is null or fiscal_quarter between 1 and 4
  ),
  constraint financial_statements_year_range check (fiscal_year between 1900 and 2200),
  constraint financial_statements_currency_known check (currency in ('USD', 'THB')),
  constraint financial_statements_market_known check (market in ('US', 'SET')),
  constraint financial_statements_symbol_length check (length(symbol) between 1 and 20),
  constraint financial_statements_source_length check (length(source) between 1 and 40)

  /*
   * Note what is NOT constrained: the figures themselves.
   *
   * A negative net income is a loss and legitimate. Negative free cash flow is a company investing.
   * Negative equity happens. Rejecting them would discard true reports; validating plausibility
   * belongs in the data-quality scan, which flags rather than refuses.
   */
);

create index financial_statements_lookup_idx
  on public.financial_statements (market, symbol, period_type, period_end desc);

comment on table public.financial_statements is
  'Company-reported figures, by fiscal period. No user_id and no reference to transactions: this is '
  'reference data about a company, never an input to a portfolio calculation.';

-- ---------------------------------------------------------------- corporate events

create table public.corporate_events (
  id         uuid primary key default gen_random_uuid(),
  symbol     text not null,
  market     text not null,
  event_type text not null,
  -- Null when the provider gave none. An event whose date is unknown is still worth listing, and
  -- inventing one would put it on a calendar on a day nothing happens.
  event_date date,
  /*
   * **Whether the date is an estimate rather than a confirmation.**
   *
   * Surfaced on every occurrence in the UI. An estimated earnings date presented as confirmed is
   * the single most misleading thing a calendar can do, because a reader plans around it.
   */
  estimated  boolean not null default false,
  title      text not null,
  detail     text,
  -- Dividend events: the amount per share and the currency it is paid in.
  amount_per_share numeric(18, 6),
  currency         text,
  -- Splits: "4:1".
  ratio      text,
  source     text not null,
  fetched_at timestamptz not null default now(),

  constraint corporate_events_type_known check (event_type in (
    'EARNINGS', 'DIVIDEND', 'EX_DIVIDEND', 'SPLIT', 'REVERSE_SPLIT', 'RIGHTS_OFFERING',
    'TENDER_OFFER', 'MERGER', 'ACQUISITION', 'AGM', 'EGM', 'OTHER'
  )),
  constraint corporate_events_market_known check (market in ('US', 'SET')),
  constraint corporate_events_currency_known check (currency is null or currency in ('USD', 'THB')),
  constraint corporate_events_symbol_length check (length(symbol) between 1 and 20),
  constraint corporate_events_title_length check (length(title) between 1 and 120),
  -- Provider free text, bounded: it is displayed, and an unbounded field is a payload.
  constraint corporate_events_detail_length check (detail is null or length(detail) <= 500),
  constraint corporate_events_ratio_length check (ratio is null or length(ratio) <= 20),
  -- A dividend amount is per share and cannot be negative; a company does not un-pay a dividend.
  constraint corporate_events_amount_non_negative check (
    amount_per_share is null or amount_per_share >= 0
  )
);

/*
 * **The idempotency guarantee for event ingestion.**
 *
 * Providers re-send the same event as its date firms up, so the same earnings release arrives twice
 * — once estimated, once confirmed. Keyed on the month rather than the exact date so a re-dated
 * event updates in place instead of appearing twice; `dedupeEvents` applies the same rule in the
 * domain, and this is what makes it true across runs.
 */
create unique index corporate_events_identity_idx
  on public.corporate_events (
    -- date_trunc('month', timestamp) is IMMUTABLE; to_char() is only STABLE and Postgres
    -- refuses it in an index expression. Same month bucket, same idempotency.
    market, symbol, event_type,
    coalesce(date_trunc('month', event_date::timestamp), '-infinity'::timestamp)
  );

create index corporate_events_calendar_idx
  on public.corporate_events (event_date, market)
  where event_date is not null;

comment on table public.corporate_events is
  'Notices about what a company is doing. An event NEVER becomes a transaction: the dividend a user '
  'received is a row they recorded, and only that row reaches the cash engine.';

-- ---------------------------------------------------------------- row level security
--
-- Shared reference data. Readable by any signed-in user; writable only by the scheduled job, which
-- holds the service-role key and bypasses RLS. No insert, update or delete policy exists, and RLS
-- denies what it does not permit.

alter table public.financial_statements enable row level security;
alter table public.corporate_events     enable row level security;

create policy "financial statements are readable by signed-in users" on public.financial_statements
  for select using ((select auth.uid()) is not null);

create policy "corporate events are readable by signed-in users" on public.corporate_events
  for select using ((select auth.uid()) is not null);
