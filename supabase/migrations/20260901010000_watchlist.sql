-- Watchlist.
--
-- One implicit list per user rather than `watchlists` + `watchlist_items`: named lists are a feature
-- nobody has asked for, and adding a list_id later is a migration, not a redesign.
--
-- name/exchange are snapshots taken when the row is created. That duplication is deliberate: the
-- watchlist page can render instantly, and a provider outage still shows which stocks are on it.
-- Prices are never stored — they are always fetched.

create table public.watchlist_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  symbol      text not null,
  market      text not null default 'US',
  name        text,
  exchange    text,
  target_price numeric(20, 8),
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint watchlist_symbol_format
    check (symbol = upper(symbol) and length(symbol) between 1 and 20),
  constraint watchlist_market_known check (market in ('US', 'SET')),
  constraint watchlist_target_price_positive check (target_price is null or target_price > 0),
  constraint watchlist_notes_length check (notes is null or length(notes) <= 500),
  -- The same stock cannot be added twice. Scoped by market because symbols only differ within one.
  constraint watchlist_unique_per_user unique (user_id, market, symbol)
);

create index watchlist_items_user_idx on public.watchlist_items (user_id, created_at desc);

create trigger watchlist_items_touch_updated_at
  before update on public.watchlist_items
  for each row execute function public.touch_updated_at();

alter table public.watchlist_items enable row level security;

create policy "watchlist items are self-readable"   on public.watchlist_items
  for select using ((select auth.uid()) = user_id);
create policy "watchlist items are self-insertable" on public.watchlist_items
  for insert with check ((select auth.uid()) = user_id);
create policy "watchlist items are self-updatable"  on public.watchlist_items
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "watchlist items are self-deletable"  on public.watchlist_items
  for delete using ((select auth.uid()) = user_id);
