-- Phase 10: investment intelligence — journal, theses, sell reviews, goals and benchmarks.
--
-- The rule that shapes every table here, and the one worth checking any future change against:
--
--   **None of these tables stores a financial result.**
--
-- There is no realized P&L column on a sell review, no portfolio value on a goal, no return on a
-- benchmark link. Those numbers are derived from transactions and market data on every request, and
-- a copy of one here would be a second source of truth for the figures this application exists to
-- get right — stale the moment a transaction is edited, and impossible to tell apart from the real
-- one. What these tables hold is the part the engine cannot compute: the user's reasoning, their
-- targets, and which index they want to be measured against.
--
-- A consequence worth stating: deleting every row added by this migration leaves holdings, average
-- cost, realized P&L and unrealized P&L byte-identical. A test asserts it.
--
-- Forward-only and additive. Ownership follows the phase 8 pattern exactly: `user_id` on every row
-- for RLS, plus a composite foreign key to `(portfolio_id, user_id)` so a child row can only
-- reference a portfolio belonging to the same user — isolation the database enforces rather than a
-- route handler remembering to.

-- ---------------------------------------------------------------- enums

create type public.journal_type as enum (
  'BUY_THESIS',
  'SELL_REASON',
  'POSITION_REVIEW',
  'MARKET_NOTE',
  'DIVIDEND_NOTE',
  'GENERAL'
);

create type public.sell_reason as enum (
  'TARGET_REACHED',
  'THESIS_BROKEN',
  'RISK_INCREASED',
  'VALUATION',
  'PORTFOLIO_REBALANCE',
  'LIQUIDITY',
  'TAX',
  'OTHER'
);

create type public.thesis_status as enum ('ACTIVE', 'CONFIRMED', 'QUESTIONED', 'BROKEN', 'CLOSED');

create type public.goal_type as enum (
  'PORTFOLIO_VALUE',
  'INVESTED_CAPITAL',
  'DIVIDEND_INCOME',
  'TOTAL_RETURN'
);

-- ---------------------------------------------------------------- investment journal
--
-- One table for every kind of note, including the sell review.
--
-- A separate `sell_reviews` table was the obvious alternative and was rejected: a sell review *is*
-- a journal entry — dated, attached to an instrument, holding the user's reasoning — that happens
-- to carry a structured reason as well. Splitting it would have produced two timelines to merge on
-- every page that shows one. The `reason` column is therefore nullable, and a check constraint
-- makes it legal only on a SELL_REASON entry, so the shape cannot drift.

create table public.investment_journals (
  id             uuid primary key default gen_random_uuid(),
  portfolio_id   uuid not null references public.portfolios (id) on delete cascade,
  -- Denormalized so every RLS policy is a single-column check with no join.
  user_id        uuid not null references auth.users (id) on delete cascade,
  -- An instrument is optional: a market note belongs to no single stock.
  symbol         text,
  market         text not null default 'US',
  -- Set on a sell review, and on any entry the user chose to pin to a specific trade. Nulled rather
  -- than cascaded-deleted with the transaction: the reasoning outlives a corrected typo in a row.
  transaction_id uuid references public.transactions (id) on delete set null,
  type           public.journal_type not null default 'GENERAL',
  reason         public.sell_reason,
  title          text not null,
  content        text not null default '',
  -- When the thinking happened, which is not always when it was typed.
  entry_date     date not null default current_date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint journals_title_length check (length(btrim(title)) between 1 and 140),
  constraint journals_content_length check (length(content) <= 10000),
  constraint journals_symbol_format
    check (symbol is null or (symbol = upper(symbol) and length(symbol) between 1 and 20)),
  constraint journals_market_known check (market in ('US', 'SET')),
  -- A structured reason is meaningful only on a sell review; anywhere else it would be a field
  -- nobody reads and every query has to remember to ignore.
  constraint journals_reason_scope check (reason is null or type = 'SELL_REASON'),
  -- A transaction-scoped entry has to say which instrument, or the position page cannot find it.
  constraint journals_transaction_needs_symbol check (transaction_id is null or symbol is not null),
  constraint journals_portfolio_fkey
    foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

-- The timeline reads a portfolio newest-first; the position page filters that by instrument.
create index journals_portfolio_idx on public.investment_journals (portfolio_id, entry_date desc, created_at desc);
create index journals_instrument_idx on public.investment_journals (portfolio_id, market, symbol);
create index journals_user_idx on public.investment_journals (user_id);
-- One sell review per transaction: a second would be an edit, not another review.
create unique index journals_sell_review_unique
  on public.investment_journals (transaction_id)
  where type = 'SELL_REASON' and transaction_id is not null;

create trigger journals_touch_updated_at
  before update on public.investment_journals
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- investment theses
--
-- One live thesis per instrument per portfolio. Superseding a thesis means editing it or closing it
-- and writing a new one, which is why the unique index below is partial on the open statuses: a
-- CLOSED thesis stays as a record and does not block the next one.

create table public.investment_theses (
  id                    uuid primary key default gen_random_uuid(),
  portfolio_id          uuid not null references public.portfolios (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  symbol                text not null,
  market                text not null default 'US',
  title                 text not null,
  why_bought            text not null default '',
  expectations          text not null default '',
  catalysts             text not null default '',
  risks                 text not null default '',
  -- What the user decided in advance would change their mind. The one field that makes a thesis
  -- reviewable rather than a diary entry — and the system never evaluates it, only shows it back.
  invalidation_criteria text not null default '',
  conviction            smallint not null default 5,
  status                public.thesis_status not null default 'ACTIVE',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint theses_title_length check (length(btrim(title)) between 1 and 140),
  constraint theses_symbol_format check (symbol = upper(symbol) and length(symbol) between 1 and 20),
  constraint theses_market_known check (market in ('US', 'SET')),
  constraint theses_conviction_range check (conviction between 1 and 10),
  constraint theses_text_length check (
    length(why_bought) <= 4000 and length(expectations) <= 4000 and
    length(catalysts) <= 4000 and length(risks) <= 4000 and
    length(invalidation_criteria) <= 4000
  ),
  constraint theses_portfolio_fkey
    foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create unique index theses_open_unique
  on public.investment_theses (portfolio_id, market, symbol)
  where status <> 'CLOSED';
create index theses_portfolio_idx on public.investment_theses (portfolio_id, updated_at desc);
create index theses_user_idx on public.investment_theses (user_id);

create trigger theses_touch_updated_at
  before update on public.investment_theses
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- portfolio goals
--
-- `target_value` means something different per type, which is why the type is an enum and not a
-- string: PORTFOLIO_VALUE and INVESTED_CAPITAL are amounts of money, DIVIDEND_INCOME is an annual
-- rate of income, TOTAL_RETURN is a percentage. `domain/goals.ts` holds the definitions, and the
-- currency constraint below is what stops the two kinds being confused in storage.

create table public.portfolio_goals (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  type         public.goal_type not null,
  target_value numeric(20, 8) not null,
  -- Null exactly when the target is a percentage. A currency on a return target would be noise; a
  -- missing one on a money target would make the goal unmeasurable.
  currency     text,
  target_date  date,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint goals_target_positive check (target_value > 0),
  constraint goals_note_length check (note is null or length(note) <= 500),
  constraint goals_currency_scope check (
    (type = 'TOTAL_RETURN' and currency is null)
    or (type <> 'TOTAL_RETURN' and currency in ('USD','THB','EUR','GBP','JPY','SGD','HKD'))
  ),
  -- A return target is a percentage; 400% is a stretch and 40000% is a typo.
  constraint goals_return_range check (type <> 'TOTAL_RETURN' or target_value <= 1000),
  -- One goal of each type per portfolio. Two conflicting value targets is a bug, not a feature.
  constraint goals_unique_per_type unique (portfolio_id, type),
  constraint goals_portfolio_fkey
    foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index goals_portfolio_idx on public.portfolio_goals (portfolio_id);
create index goals_user_idx on public.portfolio_goals (user_id);

create trigger goals_touch_updated_at
  before update on public.portfolio_goals
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- benchmarks
--
-- Reference data, not user data: the S&P 500 is the same index for everyone, so this table has no
-- `user_id` and is readable by any signed-in user and writable by none. That is also why RLS here
-- is a read-only policy rather than the ownership pattern every other table uses.
--
-- Rows are seeded below rather than hardcoded in TypeScript so a deployment can add a benchmark its
-- provider actually serves without a code change — which is the whole point of the abstraction,
-- given that index series are not on every provider's plan.

create table public.benchmarks (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  -- The symbol this deployment's market-data provider knows the index by.
  symbol     text not null,
  market     text not null,
  currency   text not null,
  created_at timestamptz not null default now(),

  constraint benchmarks_code_format check (code = upper(code) and length(code) between 2 and 20),
  constraint benchmarks_market_known check (market in ('US', 'SET')),
  constraint benchmarks_currency_known
    check (currency in ('USD','THB','EUR','GBP','JPY','SGD','HKD'))
);

insert into public.benchmarks (code, name, symbol, market, currency) values
  ('SPX', 'S&P 500',            '^GSPC', 'US',  'USD'),
  ('NDX', 'NASDAQ Composite',   '^IXIC', 'US',  'USD'),
  ('SET', 'SET Index',          '^SET',  'SET', 'THB');

-- ---------------------------------------------------------------- portfolio benchmark selection
--
-- One benchmark per portfolio. Several would need a comparison UI nobody has asked for, and the
-- unique constraint is the cheapest way to keep that decision reversible.

create table public.portfolio_benchmarks (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  benchmark_id uuid not null references public.benchmarks (id) on delete cascade,
  created_at   timestamptz not null default now(),

  constraint portfolio_benchmarks_unique unique (portfolio_id),
  constraint portfolio_benchmarks_portfolio_fkey
    foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index portfolio_benchmarks_user_idx on public.portfolio_benchmarks (user_id);

-- ---------------------------------------------------------------- row level security

alter table public.investment_journals  enable row level security;
alter table public.investment_theses    enable row level security;
alter table public.portfolio_goals      enable row level security;
alter table public.portfolio_benchmarks enable row level security;
alter table public.benchmarks           enable row level security;

create policy "journals are self-readable"   on public.investment_journals
  for select using ((select auth.uid()) = user_id);
create policy "journals are self-insertable" on public.investment_journals
  for insert with check ((select auth.uid()) = user_id);
create policy "journals are self-updatable"  on public.investment_journals
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "journals are self-deletable"  on public.investment_journals
  for delete using ((select auth.uid()) = user_id);

create policy "theses are self-readable"   on public.investment_theses
  for select using ((select auth.uid()) = user_id);
create policy "theses are self-insertable" on public.investment_theses
  for insert with check ((select auth.uid()) = user_id);
create policy "theses are self-updatable"  on public.investment_theses
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "theses are self-deletable"  on public.investment_theses
  for delete using ((select auth.uid()) = user_id);

create policy "goals are self-readable"   on public.portfolio_goals
  for select using ((select auth.uid()) = user_id);
create policy "goals are self-insertable" on public.portfolio_goals
  for insert with check ((select auth.uid()) = user_id);
create policy "goals are self-updatable"  on public.portfolio_goals
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "goals are self-deletable"  on public.portfolio_goals
  for delete using ((select auth.uid()) = user_id);

create policy "portfolio benchmarks are self-readable"   on public.portfolio_benchmarks
  for select using ((select auth.uid()) = user_id);
create policy "portfolio benchmarks are self-insertable" on public.portfolio_benchmarks
  for insert with check ((select auth.uid()) = user_id);
create policy "portfolio benchmarks are self-updatable"  on public.portfolio_benchmarks
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "portfolio benchmarks are self-deletable"  on public.portfolio_benchmarks
  for delete using ((select auth.uid()) = user_id);

-- Shared reference data: every signed-in user reads the same rows, and nobody writes them. No
-- insert, update or delete policy exists, so RLS denies all three by default.
create policy "benchmarks are readable by signed-in users" on public.benchmarks
  for select using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------- notification category
--
-- Goal, drawdown and benchmark notifications are facts about a portfolio, so they reuse the
-- existing 'portfolio' category rather than adding one. The push payload rule from phase 5 applies
-- unchanged and matters more here: a lock screen never learns what a portfolio is worth.

comment on table public.investment_journals is
  'The user''s own reasoning. Never an input to any financial calculation.';
comment on table public.investment_theses is
  'Why a position was bought and what would change the user''s mind. Status is set by the user '
  'only — the system may show facts beside a thesis but never judges one.';
comment on table public.portfolio_goals is
  'Targets. Progress is derived from the calculation engine on every request, never stored here.';
