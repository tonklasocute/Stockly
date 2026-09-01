-- Phase 6: technical alert types, cached technical snapshots and saved screens.

-- ---------------------------------------------------------------- alert types
--
-- Added to the existing enum rather than replaced: every phase-5 alert keeps working, and the
-- engine treats these identically — same crossing rule, same state machine, same cooldown.

alter type public.alert_type add value if not exists 'RSI_ABOVE';
alter type public.alert_type add value if not exists 'RSI_BELOW';
alter type public.alert_type add value if not exists 'MACD_BULLISH_CROSS';
alter type public.alert_type add value if not exists 'MACD_BEARISH_CROSS';
alter type public.alert_type add value if not exists 'PRICE_ABOVE_EMA';
alter type public.alert_type add value if not exists 'PRICE_BELOW_EMA';
alter type public.alert_type add value if not exists 'EMA_CROSS_BULLISH';
alter type public.alert_type add value if not exists 'EMA_CROSS_BEARISH';
alter type public.alert_type add value if not exists 'RELATIVE_VOLUME_ABOVE';
alter type public.alert_type add value if not exists 'ADX_ABOVE';

-- ---------------------------------------------------------------- technical snapshots
--
-- Shared reference data, not user data: a technical snapshot of NVDA is the same for everyone, so
-- it is computed once and read by all. That is what makes the screener affordable — the alternative
-- is one OHLCV request per symbol per user per run, which no free-tier provider survives.
--
-- Only the LATEST snapshot per (symbol, timeframe) is kept. Storing a full history would be a time
-- series database inside Postgres, and nothing in the app reads yesterday's indicator values —
-- charts recompute from candles, which are cached upstream by TTL.

create table public.technical_snapshots (
  symbol            text not null,
  market            text not null default 'US',
  timeframe         text not null default '1D',

  -- The bar the indicators were computed from, distinct from when we computed them. A snapshot
  -- calculated at 09:05 from a bar dated yesterday is stale data freshly processed, and the UI has
  -- to be able to tell the difference.
  source_timestamp  timestamptz,
  calculated_at     timestamptz not null default now(),

  price             numeric(20, 8),
  rsi               numeric(10, 4),
  macd              numeric(20, 8),
  macd_signal       numeric(20, 8),
  macd_histogram    numeric(20, 8),
  macd_cross        text,
  ema_cross_50_200  text,
  adx               numeric(10, 4),
  plus_di           numeric(10, 4),
  minus_di          numeric(10, 4),
  atr               numeric(20, 8),
  atr_pct           numeric(10, 4),
  relative_volume   numeric(10, 4),
  average_volume    numeric(20, 4),
  ema_20            numeric(20, 8),
  ema_50            numeric(20, 8),
  ema_200           numeric(20, 8),
  sma_50            numeric(20, 8),
  sma_200           numeric(20, 8),
  bollinger_upper   numeric(20, 8),
  bollinger_middle  numeric(20, 8),
  bollinger_lower   numeric(20, 8),

  trend             text,
  stage             text,
  score             integer,
  score_version     text not null default 'v1',
  signals           jsonb not null default '[]'::jsonb,
  candle_count      integer not null default 0,
  data_issues       jsonb not null default '[]'::jsonb,

  constraint technical_snapshots_pk primary key (symbol, market, timeframe),
  constraint technical_snapshots_score_range check (score is null or (score between 0 and 100)),
  constraint technical_snapshots_symbol_format
    check (symbol = upper(symbol) and length(symbol) between 1 and 20),
  constraint technical_snapshots_trend_known
    check (trend is null or trend in ('bullish', 'bearish', 'neutral')),
  constraint technical_snapshots_cross_known
    check (macd_cross is null or macd_cross in ('bullish', 'bearish')),
  constraint technical_snapshots_ema_cross_known
    check (ema_cross_50_200 is null or ema_cross_50_200 in ('bullish', 'bearish'))
);

-- The screener sorts by score and filters on freshness; the alert job looks symbols up directly.
create index technical_snapshots_score_idx
  on public.technical_snapshots (timeframe, score desc nulls last);
create index technical_snapshots_freshness_idx on public.technical_snapshots (calculated_at);

-- ---------------------------------------------------------------- saved screens

create table public.saved_screens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  -- A structured definition, never an executable expression. Its shape is validated by Zod at the
  -- API boundary and by the check below; the engine only ever looks metrics up in a closed enum.
  definition jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint saved_screens_name_length check (length(btrim(name)) between 1 and 60),
  constraint saved_screens_unique_name unique (user_id, name),
  -- Shape enforced in the database as well as the API: an object with a logic and a filters array.
  constraint saved_screens_definition_shape check (
    jsonb_typeof(definition) = 'object'
    and definition ? 'logic'
    and definition ? 'filters'
    and jsonb_typeof(definition -> 'filters') = 'array'
    and jsonb_array_length(definition -> 'filters') <= 10
  )
);

create index saved_screens_user_idx on public.saved_screens (user_id, created_at desc);

create trigger saved_screens_touch_updated_at
  before update on public.saved_screens
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RLS
--
-- technical_snapshots is shared reference data: readable by any signed-in user, written only by the
-- scheduled job under the service role. There is nothing user-specific in it to leak.

alter table public.technical_snapshots enable row level security;
alter table public.saved_screens       enable row level security;

create policy "technical snapshots are readable by signed-in users"
  on public.technical_snapshots
  for select using ((select auth.uid()) is not null);

create policy "saved screens are self-readable"   on public.saved_screens
  for select using ((select auth.uid()) = user_id);
create policy "saved screens are self-insertable" on public.saved_screens
  for insert with check ((select auth.uid()) = user_id);
create policy "saved screens are self-updatable"  on public.saved_screens
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "saved screens are self-deletable"  on public.saved_screens
  for delete using ((select auth.uid()) = user_id);
