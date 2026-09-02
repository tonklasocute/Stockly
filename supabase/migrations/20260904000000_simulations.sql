-- Phase 11: saved simulation scenarios.
--
-- One table, and the comment that explains why it is only one:
--
--   **A saved simulation is a set of inputs, never a result.**
--
-- There is no projected value column, no final balance, no required contribution. Those are
-- recomputed from the inputs every time the scenario is opened, by the same pure functions that
-- computed them the first time — so a saved scenario cannot go stale, cannot disagree with a fresh
-- run of itself, and can never be mistaken for something that happened. What is stored is what the
-- user typed: an assumption, a horizon, a contribution.
--
-- This is the same rule phase 10 applied to goals (progress is derived, not stored) and phase 1
-- applied to holdings (derived from transactions, never a table). A simulation is even further from
-- being a financial record than either: it describes a future that has not occurred.
--
-- Forward-only and additive. Ownership follows the phase 8 pattern: `user_id` for RLS, plus a
-- composite foreign key to `(portfolio_id, user_id)` so a scenario can only reference a portfolio
-- belonging to the same user.

create type public.simulation_type as enum (
  'COMPOUND_GROWTH',
  'DCA',
  'GOAL',
  'DIVIDEND',
  'WHAT_IF'
);

create table public.saved_simulations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- Null for a scenario that stands on its own: a compound-growth calculation needs no portfolio.
  -- MATCH SIMPLE (the default) skips the composite check when the column is null, which is exactly
  -- what that case needs — the same reasoning as alerts.portfolio_id in phase 8.
  portfolio_id uuid references public.portfolios (id) on delete cascade,
  name         text not null,
  type         public.simulation_type not null,
  /*
   * The inputs the user chose, as they were typed.
   *
   * Validated by Zod at the API boundary and shape-checked below. Deliberately a document rather
   * than columns: the five simulation types take different assumptions, and modelling that as a
   * table with thirty mostly-null columns would make adding a sixth a migration instead of a Zod
   * schema. Nothing queries inside it — a scenario is read whole, by its owner.
   */
  inputs       jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint saved_simulations_name_length check (length(btrim(name)) between 1 and 60),
  constraint saved_simulations_unique_name unique (user_id, name),
  constraint saved_simulations_inputs_object check (jsonb_typeof(inputs) = 'object'),
  -- A scenario is a handful of numbers. A cap here is the backstop for the 64 KB request limit in
  -- lib/api.ts: a document that got past one should not survive the other.
  constraint saved_simulations_inputs_size check (length(inputs::text) <= 8000),
  constraint saved_simulations_portfolio_fkey
    foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index saved_simulations_user_idx on public.saved_simulations (user_id, updated_at desc);
create index saved_simulations_portfolio_idx on public.saved_simulations (portfolio_id);

create trigger saved_simulations_touch_updated_at
  before update on public.saved_simulations
  for each row execute function public.touch_updated_at();

alter table public.saved_simulations enable row level security;

create policy "simulations are self-readable"   on public.saved_simulations
  for select using ((select auth.uid()) = user_id);
create policy "simulations are self-insertable" on public.saved_simulations
  for insert with check ((select auth.uid()) = user_id);
create policy "simulations are self-updatable"  on public.saved_simulations
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "simulations are self-deletable"  on public.saved_simulations
  for delete using ((select auth.uid()) = user_id);

comment on table public.saved_simulations is
  'Scenario inputs, never scenario results. Everything a simulation produces is recomputed from '
  'these on every read, so a saved scenario cannot go stale and is never financial history.';
