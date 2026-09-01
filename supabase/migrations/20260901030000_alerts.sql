-- Phase 5: alerts, alert events, notifications, preferences and push subscriptions.

create type public.alert_type as enum (
  'PRICE_ABOVE',
  'PRICE_BELOW',
  'PERCENT_CHANGE_ABOVE',
  'PERCENT_CHANGE_BELOW',
  'PORTFOLIO_DAILY_CHANGE_ABOVE',
  'PORTFOLIO_DAILY_CHANGE_BELOW',
  'PORTFOLIO_TOTAL_RETURN_ABOVE',
  'PORTFOLIO_TOTAL_RETURN_BELOW',
  'POSITION_WEIGHT_ABOVE',
  'POSITION_WEIGHT_BELOW',
  'DIVIDEND_RECEIVED'
);

-- The state machine lives in domain/alerts.ts; this type is the storage for it.
create type public.alert_state as enum ('armed', 'triggered', 'cooldown');

create type public.notification_category as enum ('price', 'portfolio', 'dividend', 'system');

-- ---------------------------------------------------------------- alerts

create table public.alerts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- Portfolio-scoped for portfolio and weight alerts; null for a pure price alert.
  portfolio_id      uuid references public.portfolios (id) on delete cascade,
  symbol            text,
  market            text not null default 'US',
  type              public.alert_type not null,
  -- Currency for price alerts, percent for the rest. The type says which.
  target_value      numeric(20, 8) not null,
  enabled           boolean not null default true,
  state             public.alert_state not null default 'armed',
  -- The reading at the previous evaluation, so a crossing survives a restart.
  last_value        numeric(20, 8),
  last_evaluated_at timestamptz,
  last_triggered_at timestamptz,
  cooldown_minutes  integer not null default 60,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint alerts_symbol_format
    check (symbol is null or (symbol = upper(symbol) and length(symbol) between 1 and 20)),
  constraint alerts_market_known check (market in ('US', 'SET')),
  constraint alerts_cooldown_range check (cooldown_minutes between 0 and 10080),
  constraint alerts_notes_length check (notes is null or length(notes) <= 200),
  -- A price target cannot be negative; a percentage one can (a −5% alert is normal).
  constraint alerts_price_target_non_negative check (
    type not in ('PRICE_ABOVE', 'PRICE_BELOW') or target_value >= 0
  ),
  -- A weight is a share of a portfolio, so it lives in 0–100.
  constraint alerts_weight_target_range check (
    type not in ('POSITION_WEIGHT_ABOVE', 'POSITION_WEIGHT_BELOW')
    or (target_value >= 0 and target_value <= 100)
  ),
  -- Symbol-scoped types need a symbol; portfolio-wide types must not carry one.
  constraint alerts_symbol_required check (
    (type in ('PRICE_ABOVE', 'PRICE_BELOW', 'PERCENT_CHANGE_ABOVE', 'PERCENT_CHANGE_BELOW',
              'POSITION_WEIGHT_ABOVE', 'POSITION_WEIGHT_BELOW') and symbol is not null)
    or (type in ('PORTFOLIO_DAILY_CHANGE_ABOVE', 'PORTFOLIO_DAILY_CHANGE_BELOW',
                 'PORTFOLIO_TOTAL_RETURN_ABOVE', 'PORTFOLIO_TOTAL_RETURN_BELOW') and symbol is null)
    or type = 'DIVIDEND_RECEIVED'
  ),
  -- Portfolio-derived alerts have nothing to measure without a portfolio.
  constraint alerts_portfolio_required check (
    type in ('PRICE_ABOVE', 'PRICE_BELOW', 'PERCENT_CHANGE_ABOVE', 'PERCENT_CHANGE_BELOW')
    or portfolio_id is not null
  ),
  -- The same rule twice would just mean two identical notifications.
  constraint alerts_no_duplicate_rule
    unique (user_id, type, symbol, target_value, portfolio_id)
);

-- The scheduled job's query is `enabled = true` ordered by id; the partial index keeps it cheap
-- however many disabled rules accumulate.
create index alerts_scheduled_idx on public.alerts (id) where enabled;
create index alerts_enabled_symbol_idx on public.alerts (symbol, type) where enabled;
create index alerts_user_idx on public.alerts (user_id, created_at desc);
create index alerts_portfolio_idx on public.alerts (portfolio_id) where portfolio_id is not null;

create trigger alerts_touch_updated_at
  before update on public.alerts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- alert events

create table public.alert_events (
  id              uuid primary key default gen_random_uuid(),
  alert_id        uuid not null references public.alerts (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  triggered_at    timestamptz not null default now(),
  trigger_value   numeric(20, 8) not null,
  reference_value numeric(20, 8) not null,
  message         text not null,
  created_at      timestamptz not null default now(),
  -- Two concurrent cron runs seeing the same crossing produce the same key; this turns the second
  -- insert into a conflict the job swallows, rather than a duplicate notification.
  idempotency_key text not null,
  constraint alert_events_idempotent unique (idempotency_key)
);

create index alert_events_alert_idx on public.alert_events (alert_id, triggered_at desc);
create index alert_events_user_idx on public.alert_events (user_id, triggered_at desc);

-- ---------------------------------------------------------------- notifications

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  category   public.notification_category not null,
  title      text not null,
  body       text not null,
  -- Where tapping it should go. A path, never a full URL, so it cannot become an open redirect.
  href       text,
  alert_id   uuid references public.alerts (id) on delete set null,
  read_at    timestamptz,
  created_at timestamptz not null default now(),
  constraint notifications_href_is_path check (href is null or href ~ '^/[A-Za-z0-9/_%\-\.]*$'),
  constraint notifications_title_length check (length(title) between 1 and 200),
  constraint notifications_body_length check (length(body) <= 500)
);

-- The centre lists newest first; the unread badge counts where read_at is null.
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_category_idx on public.notifications (user_id, category, created_at desc);

-- ---------------------------------------------------------------- preferences

create table public.notification_preferences (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  price      boolean not null default true,
  portfolio  boolean not null default true,
  dividend   boolean not null default true,
  system     boolean not null default true,
  push       boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_touch_updated_at
  before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- push subscriptions

create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  last_used_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- The endpoint is the browser's identity for this device. Unique globally, not per user: if a
  -- device is handed to someone else and re-subscribes, the row moves rather than duplicating.
  constraint push_subscriptions_endpoint_unique unique (endpoint),
  constraint push_subscriptions_endpoint_https check (endpoint ~ '^https://')
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create trigger push_subscriptions_touch_updated_at
  before update on public.push_subscriptions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- RLS
--
-- The scheduled job reads alerts for every user, so it runs with the service-role key, which
-- bypasses RLS by design. These policies are what protect the interactive paths.

alter table public.alerts                    enable row level security;
alter table public.alert_events              enable row level security;
alter table public.notifications             enable row level security;
alter table public.notification_preferences  enable row level security;
alter table public.push_subscriptions        enable row level security;

create policy "alerts are self-readable"   on public.alerts
  for select using ((select auth.uid()) = user_id);
create policy "alerts are self-insertable" on public.alerts
  for insert with check ((select auth.uid()) = user_id);
create policy "alerts are self-updatable"  on public.alerts
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "alerts are self-deletable"  on public.alerts
  for delete using ((select auth.uid()) = user_id);

-- Events are written by the job (service role) and only ever read by their owner.
create policy "alert events are self-readable" on public.alert_events
  for select using ((select auth.uid()) = user_id);

create policy "notifications are self-readable" on public.notifications
  for select using ((select auth.uid()) = user_id);
create policy "notifications are self-updatable" on public.notifications
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "notifications are self-deletable" on public.notifications
  for delete using ((select auth.uid()) = user_id);

create policy "preferences are self-readable"   on public.notification_preferences
  for select using ((select auth.uid()) = user_id);
create policy "preferences are self-insertable" on public.notification_preferences
  for insert with check ((select auth.uid()) = user_id);
create policy "preferences are self-updatable"  on public.notification_preferences
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "push subscriptions are self-readable"   on public.push_subscriptions
  for select using ((select auth.uid()) = user_id);
create policy "push subscriptions are self-insertable" on public.push_subscriptions
  for insert with check ((select auth.uid()) = user_id);
create policy "push subscriptions are self-updatable"  on public.push_subscriptions
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "push subscriptions are self-deletable"  on public.push_subscriptions
  for delete using ((select auth.uid()) = user_id);

-- A preferences row appears with the profile, so the app never has to handle its absence.
create or replace function public.handle_new_user_preferences()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created_preferences
  after insert on auth.users
  for each row execute function public.handle_new_user_preferences();
