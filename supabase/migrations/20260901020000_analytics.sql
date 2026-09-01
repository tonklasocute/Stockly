-- Phase 3: dividends, cash transactions and portfolio snapshots.

-- ---------------------------------------------------------------- dividends
--
-- ex_date and record_date are omitted: Stockly records dividends the user actually received, and
-- neither date affects a single figure it computes. They can be added when something needs them.

create table public.dividends (
  id                 uuid primary key default gen_random_uuid(),
  portfolio_id       uuid not null references public.portfolios (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  symbol             text not null,
  market             text not null default 'US',
  payment_date       date not null,
  shares             numeric(20, 8) not null,
  dividend_per_share numeric(20, 8) not null,
  tax                numeric(20, 8) not null default 0,
  fee                numeric(20, 8) not null default 0,
  currency           text not null default 'USD',
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint dividends_shares_positive check (shares > 0),
  constraint dividends_per_share_non_negative check (dividend_per_share >= 0),
  constraint dividends_tax_non_negative check (tax >= 0),
  constraint dividends_fee_non_negative check (fee >= 0),
  constraint dividends_symbol_format check (symbol = upper(symbol) and length(symbol) between 1 and 20),
  constraint dividends_market_known check (market in ('US', 'SET')),
  constraint dividends_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint dividends_notes_length check (notes is null or length(notes) <= 500)
);

-- Analytics reads a portfolio's dividends in payment order; the symbol index serves per-stock views.
create index dividends_portfolio_idx on public.dividends (portfolio_id, payment_date desc);
create index dividends_symbol_idx on public.dividends (portfolio_id, symbol);
create index dividends_user_idx on public.dividends (user_id);

create trigger dividends_touch_updated_at
  before update on public.dividends
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- cash transactions

create type public.cash_transaction_kind as enum ('deposit', 'withdrawal');

create table public.cash_transactions (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         public.cash_transaction_kind not null,
  amount       numeric(20, 8) not null,
  currency     text not null default 'USD',
  occurred_on  date not null,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Direction lives in `kind`; a negative amount would let the same movement be expressed two ways.
  constraint cash_amount_positive check (amount > 0),
  constraint cash_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint cash_notes_length check (notes is null or length(notes) <= 500)
);

create index cash_transactions_portfolio_idx
  on public.cash_transactions (portfolio_id, occurred_on desc);
create index cash_transactions_user_idx on public.cash_transactions (user_id);

create trigger cash_transactions_touch_updated_at
  before update on public.cash_transactions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- portfolio snapshots
--
-- Portfolio VALUE over time cannot be reconstructed from transactions: it needs a market price for
-- every past day, which the provider's free tier cannot supply per symbol per day. So value history
-- is accumulated forward, one row per portfolio per day.
--
-- Invested capital, by contrast, IS derivable from transactions (domain/analytics.ts), so it is
-- never stored — only the market-dependent figures are.

create table public.portfolio_snapshots (
  id             uuid primary key default gen_random_uuid(),
  portfolio_id   uuid not null references public.portfolios (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  snapshot_date  date not null,
  total_value    numeric(20, 8) not null,
  invested_value numeric(20, 8) not null,
  cash_value     numeric(20, 8) not null default 0,
  realized_pnl   numeric(20, 8) not null default 0,
  unrealized_pnl numeric(20, 8) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- One row per portfolio per day. The upsert on this constraint is what makes taking a snapshot
  -- idempotent: reloading the analytics page ten times refreshes today's row, never duplicates it.
  constraint portfolio_snapshots_unique_per_day unique (portfolio_id, snapshot_date)
);

create index portfolio_snapshots_series_idx
  on public.portfolio_snapshots (portfolio_id, snapshot_date);

create trigger portfolio_snapshots_touch_updated_at
  before update on public.portfolio_snapshots
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- ownership + RLS

-- Same invariant as transactions: the portfolio must belong to the row's owner.
create trigger dividends_portfolio_ownership
  before insert or update on public.dividends
  for each row execute function public.transaction_portfolio_belongs_to_user();

create trigger cash_transactions_portfolio_ownership
  before insert or update on public.cash_transactions
  for each row execute function public.transaction_portfolio_belongs_to_user();

create trigger portfolio_snapshots_portfolio_ownership
  before insert or update on public.portfolio_snapshots
  for each row execute function public.transaction_portfolio_belongs_to_user();

alter table public.dividends           enable row level security;
alter table public.cash_transactions   enable row level security;
alter table public.portfolio_snapshots enable row level security;

create policy "dividends are self-readable"   on public.dividends
  for select using ((select auth.uid()) = user_id);
create policy "dividends are self-insertable" on public.dividends
  for insert with check ((select auth.uid()) = user_id);
create policy "dividends are self-updatable"  on public.dividends
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "dividends are self-deletable"  on public.dividends
  for delete using ((select auth.uid()) = user_id);

create policy "cash transactions are self-readable"   on public.cash_transactions
  for select using ((select auth.uid()) = user_id);
create policy "cash transactions are self-insertable" on public.cash_transactions
  for insert with check ((select auth.uid()) = user_id);
create policy "cash transactions are self-updatable"  on public.cash_transactions
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "cash transactions are self-deletable"  on public.cash_transactions
  for delete using ((select auth.uid()) = user_id);

create policy "snapshots are self-readable"   on public.portfolio_snapshots
  for select using ((select auth.uid()) = user_id);
create policy "snapshots are self-insertable" on public.portfolio_snapshots
  for insert with check ((select auth.uid()) = user_id);
create policy "snapshots are self-updatable"  on public.portfolio_snapshots
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "snapshots are self-deletable"  on public.portfolio_snapshots
  for delete using ((select auth.uid()) = user_id);
