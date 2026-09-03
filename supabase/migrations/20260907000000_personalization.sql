-- Phase 15: personalization — preferences, dashboard layout, saved views, tags.
--
-- The rule this migration is built around:
--
--   **Nothing here is an input to a financial calculation.**
--
-- A preference decides what a page *shows* and in what order. A tag is a label somebody put on a
-- position. A saved view is a filter and a sort. Delete every table below and every holding, cost
-- basis and P&L figure is exactly what it was — the same guarantee phase 10 made for journals and
-- phase 13 made for sharing, enforced the same way, by a test that reads the calculation modules'
-- source.
--
-- **One table for preferences, not eight.** The obvious design is a table per concept —
-- DashboardLayout, PinnedItem, RecentItem, InsightPreference, FavoriteMetric. Every one of those is
-- a small, user-scoped, read-together-written-together document with no relationships and no
-- queries of its own, so five tables would be five sets of policies and five round trips to render
-- one page. They are columns on one row instead. `saved_views` and the tag tables are separate
-- because they *are* queried and joined; the rest are not.
--
-- Forward-only and additive.

-- ---------------------------------------------------------------- preferences

create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,

  -- Presentation. `system` follows the device, which is what next-themes already does — this makes
  -- the choice survive a new device rather than living only in that browser's localStorage.
  theme   text not null default 'system',
  density text not null default 'comfortable',

  /*
   * The portfolio the app opens on.
   *
   * `on delete set null`, so deleting a portfolio can never delete a preference row and can never
   * leave it pointing at something gone. A null default simply means "the first one", which is
   * what the app did before this column existed.
   */
  default_portfolio_id uuid references public.portfolios (id) on delete set null,

  /*
   * Five documents, each a plain array. jsonb rather than five tables for the reason in the header;
   * each is size-capped below so a preference row can never become a payload.
   *
   * `dashboard_layout` empty means **the default layout**, not an empty dashboard. A new user has
   * no row at all and gets the default; a user who resets goes back to `[]` rather than to a stored
   * copy of the default, which would then be frozen at whatever the default was on the day they
   * pressed it.
   */
  favorite_metrics   jsonb not null default '[]'::jsonb,
  dashboard_layout   jsonb not null default '[]'::jsonb,
  dismissed_insights jsonb not null default '[]'::jsonb,
  pinned_items       jsonb not null default '[]'::jsonb,
  recent_items       jsonb not null default '[]'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_preferences_theme_known check (theme in ('system', 'light', 'dark')),
  constraint user_preferences_density_known check (density in ('comfortable', 'compact')),
  constraint user_preferences_favorite_metrics_shape check (
    jsonb_typeof(favorite_metrics) = 'array' and length(favorite_metrics::text) <= 2000
  ),
  constraint user_preferences_layout_shape check (
    jsonb_typeof(dashboard_layout) = 'array' and length(dashboard_layout::text) <= 8000
  ),
  constraint user_preferences_dismissed_shape check (
    jsonb_typeof(dismissed_insights) = 'array' and length(dismissed_insights::text) <= 4000
  ),
  constraint user_preferences_pinned_shape check (
    jsonb_typeof(pinned_items) = 'array' and length(pinned_items::text) <= 4000
  ),
  constraint user_preferences_recent_shape check (
    jsonb_typeof(recent_items) = 'array' and length(recent_items::text) <= 4000
  )
);

create trigger user_preferences_touch_updated_at
  before update on public.user_preferences
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- tags
--
-- A tag belongs to a **user**, not to a portfolio: "High conviction" means the same thing across
-- every portfolio somebody owns, and a per-portfolio tag would have to be created again in each.

create table public.tags (
  id      uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name    text not null,
  -- A token from a fixed palette, never a hex value: an arbitrary colour from a text field is a
  -- contrast bug waiting to happen, and it would not adapt between light and dark mode.
  color   text not null default 'slate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tags_name_length check (length(name) between 1 and 30),
  constraint tags_color_known check (
    color in ('slate', 'blue', 'green', 'amber', 'red', 'violet', 'teal', 'pink')
  ),
  -- Case-insensitively unique per user, so "Growth" and "growth" cannot both exist and quietly
  -- split a group in two.
  constraint tags_unique_per_user unique (user_id, name)
);

create unique index tags_name_ci_idx on public.tags (user_id, lower(name));
create index tags_user_idx on public.tags (user_id);

/*
 * A tag applied to an instrument, inside one portfolio.
 *
 * Keyed by `(portfolio_id, market, symbol)` rather than by a holding id, because **a holding is not
 * a row** — it is derived by replaying transactions. Tagging a holding id would mean inventing one,
 * which is the first step towards a second source of truth. A tag on a position the user has since
 * sold simply stops appearing; nothing breaks and nothing is deleted.
 */
create table public.holding_tags (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  tag_id       uuid not null references public.tags (id) on delete cascade,
  market       text not null,
  symbol       text not null,
  created_at   timestamptz not null default now(),

  constraint holding_tags_symbol_length check (length(symbol) between 1 and 20),
  constraint holding_tags_market_known check (market in ('US', 'SET')),
  constraint holding_tags_unique unique (portfolio_id, tag_id, market, symbol),

  foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index holding_tags_portfolio_idx on public.holding_tags (portfolio_id, market, symbol);
create index holding_tags_tag_idx on public.holding_tags (tag_id);

-- ---------------------------------------------------------------- saved views
--
-- A view is **not a portfolio**. It is a filter, a sort, a set of columns and a grouping, saved
-- under a name. It holds no figure, so it cannot go stale and cannot disagree with the table it
-- configures.

create table public.saved_views (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- Null means the view applies to every portfolio. "Dividend stocks" is rarely about one.
  portfolio_id uuid references public.portfolios (id) on delete cascade,
  name         text not null,
  /*
   * `{ filters, sort, columns, groupBy }` — every field a closed enum validated by Zod at the
   * boundary. Never an expression and never a string the server interprets, exactly as the
   * screener's filters are not.
   */
  config       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint saved_views_name_length check (length(name) between 1 and 40),
  constraint saved_views_config_shape check (
    jsonb_typeof(config) = 'object' and length(config::text) <= 4000
  ),
  constraint saved_views_unique_name unique (user_id, name)
);

create index saved_views_user_idx on public.saved_views (user_id, created_at desc);
create index saved_views_portfolio_idx on public.saved_views (portfolio_id);

create trigger saved_views_touch_updated_at
  before update on public.saved_views
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- watchlist ordering
--
-- Extends the existing table rather than adding a second watchlist concept. Two nullable columns:
-- a manual sort position and a pin. Absent means "as before", so nothing changes for anyone who
-- never touches either.

alter table public.watchlist_items
  add column sort_order integer,
  add column pinned     boolean not null default false;

create index watchlist_items_order_idx
  on public.watchlist_items (user_id, pinned desc, sort_order nulls last);

-- ---------------------------------------------------------------- row level security

alter table public.user_preferences enable row level security;
alter table public.tags             enable row level security;
alter table public.holding_tags     enable row level security;
alter table public.saved_views      enable row level security;

create policy "preferences are self-readable"   on public.user_preferences
  for select using ((select auth.uid()) = user_id);
create policy "preferences are self-insertable" on public.user_preferences
  for insert with check ((select auth.uid()) = user_id);
create policy "preferences are self-updatable"  on public.user_preferences
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "preferences are self-deletable"  on public.user_preferences
  for delete using ((select auth.uid()) = user_id);

create policy "tags are self-readable"   on public.tags
  for select using ((select auth.uid()) = user_id);
create policy "tags are self-insertable" on public.tags
  for insert with check ((select auth.uid()) = user_id);
create policy "tags are self-updatable"  on public.tags
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tags are self-deletable"  on public.tags
  for delete using ((select auth.uid()) = user_id);

create policy "holding tags are self-readable"   on public.holding_tags
  for select using ((select auth.uid()) = user_id);
create policy "holding tags are self-insertable" on public.holding_tags
  for insert with check ((select auth.uid()) = user_id);
create policy "holding tags are self-deletable"  on public.holding_tags
  for delete using ((select auth.uid()) = user_id);

create policy "saved views are self-readable"   on public.saved_views
  for select using ((select auth.uid()) = user_id);
create policy "saved views are self-insertable" on public.saved_views
  for insert with check ((select auth.uid()) = user_id);
create policy "saved views are self-updatable"  on public.saved_views
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "saved views are self-deletable"  on public.saved_views
  for delete using ((select auth.uid()) = user_id);

comment on table public.user_preferences is
  'One row per user. Five documents in jsonb rather than five tables: each is read together, '
  'written together, has no relationships and is never queried by its contents.';
comment on column public.user_preferences.dashboard_layout is
  'Empty array means THE DEFAULT LAYOUT, not an empty dashboard. Resetting stores [] rather than a '
  'copy of the default, which would freeze at whatever the default was that day.';
comment on table public.holding_tags is
  'Keyed by (portfolio, market, symbol), never by a holding id — a holding is derived from '
  'transactions, not stored, and inventing an id for one is the first step to a second source of truth.';
comment on table public.saved_views is
  'A filter, a sort, columns and a grouping. Holds no figure, so it cannot go stale.';
