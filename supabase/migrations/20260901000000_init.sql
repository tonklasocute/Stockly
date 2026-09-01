-- Stockly MVP schema: profiles, portfolios, transactions.
--
-- Holdings are NOT a table. They are derived by replaying transactions (see domain/holdings.ts),
-- so an edited or deleted transaction can never leave a stale position behind.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- helpers

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------- profiles

create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- A profile row is created by the database, not by the client, so a user can never exist without one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- portfolios

create table public.portfolios (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null,
  currency   text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint portfolios_name_not_blank check (length(btrim(name)) between 1 and 60),
  constraint portfolios_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint portfolios_name_unique_per_user unique (user_id, name)
);

create index portfolios_user_id_idx on public.portfolios (user_id, created_at);

create trigger portfolios_touch_updated_at
  before update on public.portfolios
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- transactions

create type public.transaction_side as enum ('buy', 'sell');

create table public.transactions (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  -- Denormalized so every RLS policy is a single-column check with no join.
  user_id      uuid not null references auth.users (id) on delete cascade,
  symbol       text not null,
  market       text not null default 'US',
  side         public.transaction_side not null,
  trade_date   date not null,
  quantity     numeric(20, 8) not null,
  price        numeric(20, 8) not null,
  fee          numeric(20, 8) not null default 0,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint transactions_quantity_positive check (quantity > 0),
  constraint transactions_price_non_negative check (price >= 0),
  constraint transactions_fee_non_negative check (fee >= 0),
  constraint transactions_symbol_format check (symbol = upper(symbol) and length(symbol) between 1 and 20),
  constraint transactions_notes_length check (notes is null or length(notes) <= 500)
);

-- Replaying a portfolio reads every row for that portfolio in trade order.
create index transactions_portfolio_idx on public.transactions (portfolio_id, trade_date, created_at);
create index transactions_user_idx on public.transactions (user_id);
create index transactions_symbol_idx on public.transactions (portfolio_id, symbol);

create trigger transactions_touch_updated_at
  before update on public.transactions
  for each row execute function public.touch_updated_at();

-- The portfolio must belong to the same user as the transaction. RLS on its own would let a user
-- attach their own row to their own portfolio only, but this keeps the invariant in the schema.
create or replace function public.transaction_portfolio_belongs_to_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.portfolios
    where id = new.portfolio_id and user_id = new.user_id
  ) then
    raise exception 'portfolio % does not belong to user %', new.portfolio_id, new.user_id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger transactions_portfolio_ownership
  before insert or update on public.transactions
  for each row execute function public.transaction_portfolio_belongs_to_user();

-- ---------------------------------------------------------------- row level security

alter table public.profiles     enable row level security;
alter table public.portfolios   enable row level security;
alter table public.transactions enable row level security;

create policy "profiles are self-readable"  on public.profiles
  for select using ((select auth.uid()) = id);
create policy "profiles are self-writable"  on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "portfolios are self-readable"   on public.portfolios
  for select using ((select auth.uid()) = user_id);
create policy "portfolios are self-insertable" on public.portfolios
  for insert with check ((select auth.uid()) = user_id);
create policy "portfolios are self-updatable"  on public.portfolios
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "portfolios are self-deletable"  on public.portfolios
  for delete using ((select auth.uid()) = user_id);

create policy "transactions are self-readable"   on public.transactions
  for select using ((select auth.uid()) = user_id);
create policy "transactions are self-insertable" on public.transactions
  for insert with check ((select auth.uid()) = user_id);
create policy "transactions are self-updatable"  on public.transactions
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "transactions are self-deletable"  on public.transactions
  for delete using ((select auth.uid()) = user_id);
