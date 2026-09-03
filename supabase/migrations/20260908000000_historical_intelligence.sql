-- Phase 16: historical intelligence and performance attribution.
--
-- The rule this migration is built around, and the one to check any future change against:
--
--   **Nothing here is a source of truth. Every row is a reading that could be recomputed.**
--
-- A snapshot records what a portfolio was worth on a day, because a *price* on a past day is the
-- one thing Stockly cannot reconstruct — quantities, cost basis, realised P&L and cash all come
-- from replaying transactions and are exact whenever they are asked for. That asymmetry is the
-- whole reason this table exists, and the reason it holds so little.
--
-- What this migration does NOT do, deliberately:
--
--   * It does not store holdings. `domain/history.ts` reconstructs them from transactions.
--   * It does not store a return, a contribution or a drawdown. All three are derived on read.
--   * It does not create a second snapshot table. `portfolio_snapshots` has existed since phase 3
--     and is extended here — a parallel one would be two answers to "what was it worth in March".
--
-- Forward-only and additive.

-- ---------------------------------------------------------------- snapshot provenance
--
-- Three columns that turn an opportunistic daily row into an auditable historical record.

alter table public.portfolio_snapshots
  add column quality             text not null default 'COMPLETE',
  add column calculation_version integer not null default 1,
  add column missing_holdings    integer not null default 0,
  -- Which job or page produced the row. A snapshot written by the scheduled job at the close is a
  -- different kind of evidence from one written because somebody happened to open the analytics
  -- page at 11am, and a chart that mixed them without saying so would be misleading about *when*.
  add column source              text not null default 'PAGE_VIEW';

comment on column public.portfolio_snapshots.quality is
  'COMPLETE, PARTIAL or STALE. A PARTIAL row carries a value AND the count of what is missing from '
  'it, because a total that quietly excluded two holdings looks exactly like one that included them.';

comment on column public.portfolio_snapshots.calculation_version is
  'The engine version that produced this row. Bumped when a calculation changes meaning, so an old '
  'row stays interpretable instead of being silently reinterpreted under new rules.';

alter table public.portfolio_snapshots
  add constraint portfolio_snapshots_quality_known
    check (quality in ('COMPLETE', 'PARTIAL', 'STALE')),
  add constraint portfolio_snapshots_source_known
    check (source in ('PAGE_VIEW', 'SCHEDULED', 'BACKFILL')),
  add constraint portfolio_snapshots_version_positive
    check (calculation_version > 0),
  add constraint portfolio_snapshots_missing_non_negative
    check (missing_holdings >= 0),
  -- A complete snapshot cannot be missing anything. The two columns must agree, and a constraint
  -- is the only way to guarantee they always will.
  add constraint portfolio_snapshots_quality_agrees
    check ((quality = 'COMPLETE') = (missing_holdings = 0));

/*
 * **Idempotency for the snapshot job.**
 *
 * The unique constraint on (portfolio_id, snapshot_date) has existed since phase 3, and it is what
 * makes running the job twice in one day safe: the second run upserts the same row rather than
 * appending a second reading for the same date. Restated here because a later migration that
 * rewrites this table must bring it along.
 */

-- Reading a date range for one portfolio, which is what every historical chart does.
create index portfolio_snapshots_range_idx
  on public.portfolio_snapshots (portfolio_id, snapshot_date desc);

-- ---------------------------------------------------------------- historical exchange rates
--
-- **The table that makes FX attribution possible — and only from the day it starts filling.**
--
-- Stockly has never stored an exchange rate: `domain/fx.ts` fetches today's and caches it for ten
-- minutes, which is why `PortfolioSummary.fxEffect` has been typed `null` since phase 9 with a
-- comment explaining that separating currency movement from asset performance needs a rate on every
-- past trade date.
--
-- This begins accumulating them. It does **not** retroactively make FX attribution available: a
-- period before the first stored rate has no rates, and the engine reports `null` for it rather
-- than interpolating. Backfilling from a provider is possible where one offers a time series, and
-- `docs/historical-rebuild.md` describes the bounded job that would do it — but a rate that was
-- never fetched is not a rate, and this schema will not pretend otherwise.

create table public.fx_rates_daily (
  -- Reference data, not user data: one USD/THB rate for a date serves everybody.
  base       text not null,
  quote      text not null,
  rate_date  date not null,
  rate       numeric(20, 10) not null,
  -- Which provider said so, so a correction can be traced rather than merely applied.
  source     text not null default 'PROVIDER',
  created_at timestamptz not null default now(),

  primary key (base, quote, rate_date),

  constraint fx_rates_daily_currencies_known check (
    base in ('USD', 'THB') and quote in ('USD', 'THB') and base <> quote
  ),
  -- A rate is a ratio of two prices. Zero and negative are not slightly wrong, they are impossible,
  -- and accepting one would silently value a portfolio at nothing.
  constraint fx_rates_daily_rate_positive check (rate > 0),
  constraint fx_rates_daily_source_known check (source in ('PROVIDER', 'MANUAL')),
  constraint fx_rates_daily_not_future check (rate_date <= (now() at time zone 'utc')::date)
);

create index fx_rates_daily_pair_idx on public.fx_rates_daily (base, quote, rate_date desc);

comment on table public.fx_rates_daily is
  'Daily exchange rates, accumulated from the day this table was created. A period before the first '
  'stored rate has none, and FX attribution reports null for it rather than interpolating.';

-- ---------------------------------------------------------------- row level security
--
-- Shared reference data, exactly like `benchmarks` and `technical_snapshots`: readable by any
-- signed-in user, writable by nobody through a request. Only the scheduled job writes here, and it
-- holds the service-role key, which bypasses RLS.

alter table public.fx_rates_daily enable row level security;

create policy "fx rates are readable by signed-in users" on public.fx_rates_daily
  for select using ((select auth.uid()) is not null);

-- No insert, update or delete policy exists. RLS denies all three by default, so a request cannot
-- write a rate however it is authenticated.
