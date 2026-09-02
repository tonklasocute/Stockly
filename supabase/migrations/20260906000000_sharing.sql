-- Phase 13: portfolio sharing, share links and share snapshots.
--
-- The rule this migration is built around:
--
--   **Nothing here is an input to a financial calculation, and nothing anonymous can reach a
--   transaction.**
--
-- Sharing sits above the engine. A share row is configuration, a snapshot is a rendered artefact,
-- and neither can move a holding, a cost basis or a P&L figure. Deleting every table below leaves
-- every portfolio number exactly as it was.
--
-- The second decision worth reading before changing anything here is *how anonymous access works*.
-- Stockly's authorization boundary is RLS, and the service-role key is deliberately unreachable
-- from a request. So a visitor never reads a portfolio: they read a **published projection** — a
-- jsonb document the owner's own session produced, containing only the fields their sharing
-- settings allow. Anonymous SELECT is granted on that one column of that one table, and on nothing
-- else in the database. A bug in the projection can leak at most what the owner published; it can
-- never reach `transactions`, because no anonymous role has any grant that leads there.
--
-- Forward-only and additive.

-- ---------------------------------------------------------------- visibility

/*
 *   PRIVATE    only the owner. The default, and what a portfolio with no row here is.
 *   LINK_ONLY  reachable only by presenting an unguessable token. Never indexed, never listed.
 *   PUBLIC     reachable at /p/<slug>. Indexed only if the owner also asked for that.
 *
 * An enum rather than `is_public boolean` because these are three different answers to "who can
 * reach this", and a boolean cannot hold the third without a second boolean beside it that can
 * contradict the first.
 */
create type public.share_visibility as enum ('PRIVATE', 'LINK_ONLY', 'PUBLIC');

-- ---------------------------------------------------------------- share configuration
--
-- One row per portfolio. Absent means PRIVATE — the default is the absence of the feature, not a
-- row that has to be written correctly.
--
-- Every `show_*` column defaults to **false**. A section becomes visible because the owner turned
-- it on, never because a new column was added with a convenient default.

create table public.portfolio_shares (
  id            uuid primary key default gen_random_uuid(),
  portfolio_id  uuid not null references public.portfolios (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,

  visibility    public.share_visibility not null default 'PRIVATE',

  -- The public URL segment. Null until the owner picks one; unique across the deployment.
  slug          text,
  -- What a visitor is told the portfolio is called. Never the portfolio's own name unless the
  -- owner copied it across, and never the account's email.
  display_name  text,
  description   text,
  -- What the owner wants to be called on the page. Free text they typed, and the only identity a
  -- visitor ever sees: an email address must never become a byline because a field was left blank.
  owner_display_name text,

  -- Sections.
  show_overview     boolean not null default false,
  show_holdings     boolean not null default false,
  show_allocation   boolean not null default false,
  show_performance  boolean not null default false,
  show_risk         boolean not null default false,
  show_dividends    boolean not null default false,
  show_benchmark    boolean not null default false,
  show_insights     boolean not null default false,
  -- Phase 10's journal, theses and goals are the user's own reasoning and personal targets. Goals
  -- can be shared as *progress only*; the journal and theses have no flag at all, because the
  -- projection has nowhere to put them. See domain/sharing.ts.
  show_goals        boolean not null default false,

  -- Figures. Each one independently withheld, because "I will show what I hold" and "I will show
  -- how much it is worth" are different decisions.
  show_absolute_values boolean not null default false,
  show_quantity        boolean not null default false,
  show_unrealized_pnl  boolean not null default false,
  show_realized_pnl    boolean not null default false,
  show_cash            boolean not null default false,

  -- Off by default. A PUBLIC portfolio is reachable by anyone holding the link; being *indexed* is
  -- a further step the owner takes deliberately.
  allow_search_indexing boolean not null default false,

  /*
   * Bumped on every settings change. A published projection carries the version it was built from,
   * so "these settings are newer than what visitors see" is answerable without diffing two jsonb
   * documents.
   */
  settings_version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint portfolio_shares_one_per_portfolio unique (portfolio_id),
  constraint portfolio_shares_slug_unique unique (slug),
  -- URL-safe, lowercase, no leading/trailing/double hyphen. Enforced here as well as in Zod: a
  -- slug is a routing key, and a routing key the database will accept but the router will not is a
  -- 404 nobody can explain.
  constraint portfolio_shares_slug_shape check (
    slug is null or slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
  ),
  constraint portfolio_shares_slug_length check (slug is null or length(slug) between 3 and 48),
  constraint portfolio_shares_display_name_length check (
    display_name is null or length(display_name) between 1 and 60
  ),
  constraint portfolio_shares_description_length check (
    description is null or length(description) <= 280
  ),
  constraint portfolio_shares_owner_name_length check (
    owner_display_name is null or length(owner_display_name) between 1 and 40
  ),
  -- A portfolio cannot be public without an address to be public at.
  constraint portfolio_shares_public_needs_slug check (
    visibility <> 'PUBLIC' or slug is not null
  ),
  -- Indexing is a property of a public page. A LINK_ONLY page has no business being crawled.
  constraint portfolio_shares_indexing_needs_public check (
    allow_search_indexing = false or visibility = 'PUBLIC'
  ),
  constraint portfolio_shares_settings_version_positive check (settings_version > 0),

  -- The composite key is the ownership guarantee: a share row cannot point at a portfolio that
  -- belongs to somebody else, whatever a request body claims.
  foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index portfolio_shares_user_idx on public.portfolio_shares (user_id);

create trigger portfolio_shares_touch_updated_at
  before update on public.portfolio_shares
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- the published projection
--
-- **The only table an anonymous visitor can read, and it contains no portfolio.**
--
-- `payload` is a PublicPortfolio document built by domain/sharing.ts from the owner's own
-- authenticated session: already filtered, already rounded, already stripped of everything the
-- settings withhold. There is no transaction in it, no user id, no portfolio id, no email.
--
-- Publishing is an explicit act. A portfolio's live figures move whenever a price does; what a
-- visitor sees moves when the owner republishes, and the page says when that was. Calling a
-- projection that is minutes old "live" would be the kind of small dishonesty this codebase spends
-- its comments avoiding.

create table public.published_shares (
  portfolio_id     uuid primary key references public.portfolios (id) on delete cascade,
  -- Denormalised from portfolio_shares so the anonymous read is one index lookup and the RLS
  -- predicate needs no join to a table anon cannot see.
  slug             text not null,
  visibility       public.share_visibility not null,
  -- Denormalised too: whether a crawler may index this page is a property of the share, and the
  -- anonymous role cannot read portfolio_shares to find out. Constrained below so a LINK_ONLY row
  -- can never carry it, whatever wrote the row.
  allow_search_indexing boolean not null default false,
  payload          jsonb not null,
  settings_version integer not null,
  published_at     timestamptz not null default now(),

  constraint published_shares_slug_unique unique (slug),
  constraint published_shares_not_private check (visibility <> 'PRIVATE'),
  constraint published_shares_indexing_needs_public check (
    allow_search_indexing = false or visibility = 'PUBLIC'
  ),
  -- A published document is a page, not a database export. The cap is generous for a hundred-
  -- holding portfolio with a performance series and small enough that a public read stays cheap.
  constraint published_shares_payload_size check (length(payload::text) <= 256000)
);

create index published_shares_public_idx
  on public.published_shares (slug)
  where visibility = 'PUBLIC';

-- ---------------------------------------------------------------- share links
--
-- A capability, not an identity: holding the token is the whole authorization. So the token is 32
-- random bytes and **only its SHA-256 is stored** — a database dump discloses no working link, and
-- the raw token is shown exactly once, when it is created.

create table public.portfolio_share_links (
  id               uuid primary key default gen_random_uuid(),
  portfolio_id     uuid not null references public.portfolios (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  -- SHA-256 hex of the token. Never the token.
  token_hash       text not null,
  label            text,
  expires_at       timestamptz,
  revoked_at       timestamptz,
  -- Deliberately coarse. Enough for "is anyone using this link?" and nothing that identifies a
  -- viewer: no IP, no user agent, no referrer, no geography.
  access_count     integer not null default 0,
  last_accessed_at timestamptz,
  created_at       timestamptz not null default now(),

  constraint portfolio_share_links_token_unique unique (token_hash),
  constraint portfolio_share_links_token_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint portfolio_share_links_label_length check (label is null or length(label) between 1 and 60),
  constraint portfolio_share_links_access_count_non_negative check (access_count >= 0),

  foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index portfolio_share_links_portfolio_idx
  on public.portfolio_share_links (portfolio_id, created_at desc);

-- ---------------------------------------------------------------- snapshots
--
-- Named `share_snapshots`, not `portfolio_snapshots`: that table already exists and is phase 3's
-- daily value series, an input to the performance chart. These are something else entirely — a
-- frozen, addressable copy of a published projection.
--
-- **Immutable.** There is no update policy and no updated_at. A snapshot that could be edited would
-- be a financial record that can be rewritten after the fact, which is the opposite of the point.

create table public.share_snapshots (
  id            uuid primary key default gen_random_uuid(),
  portfolio_id  uuid not null references public.portfolios (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  -- The snapshot's own capability token, hashed exactly as a share link's is. A snapshot URL is
  -- unguessable on its own and does not depend on the portfolio being public.
  token_hash    text not null,
  -- Schema version of `payload`. An old snapshot stays readable when the projection changes shape.
  version       integer not null default 1,
  label         text,
  base_currency text not null,
  -- When the figures inside were calculated — not when the row was written. They can differ by the
  -- age of the analytics pass, and the page shows this one.
  calculated_at timestamptz not null,
  payload       jsonb not null,
  created_at    timestamptz not null default now(),

  constraint share_snapshots_token_unique unique (token_hash),
  constraint share_snapshots_token_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint share_snapshots_version_positive check (version > 0),
  constraint share_snapshots_label_length check (label is null or length(label) between 1 and 60),
  constraint share_snapshots_currency_known check (base_currency in ('USD', 'THB')),
  constraint share_snapshots_payload_size check (length(payload::text) <= 256000),

  foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index share_snapshots_portfolio_idx
  on public.share_snapshots (portfolio_id, created_at desc);

-- ---------------------------------------------------------------- audit
--
-- What the owner did, so "when did this become public?" has an answer. Never who looked at it.

create table public.share_events (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  action       text not null,
  -- A visibility, a link label, a snapshot id. Never a figure and never a token.
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),

  constraint share_events_action_known check (action in (
    'VISIBILITY_CHANGED', 'SETTINGS_CHANGED', 'PUBLISHED', 'UNPUBLISHED',
    'LINK_CREATED', 'LINK_REVOKED', 'SNAPSHOT_CREATED', 'SNAPSHOT_DELETED'
  )),
  constraint share_events_detail_size check (length(detail::text) <= 1000),

  foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index share_events_portfolio_idx on public.share_events (portfolio_id, created_at desc);

-- ---------------------------------------------------------------- row level security

alter table public.portfolio_shares      enable row level security;
alter table public.published_shares      enable row level security;
alter table public.portfolio_share_links enable row level security;
alter table public.share_snapshots       enable row level security;
alter table public.share_events          enable row level security;

create policy "shares are self-readable"   on public.portfolio_shares
  for select using ((select auth.uid()) = user_id);
create policy "shares are self-insertable" on public.portfolio_shares
  for insert with check ((select auth.uid()) = user_id);
create policy "shares are self-updatable"  on public.portfolio_shares
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "shares are self-deletable"  on public.portfolio_shares
  for delete using ((select auth.uid()) = user_id);

/*
 * **The one anonymous grant in the schema.**
 *
 * A visitor may read a published document, and only one whose owner set it to PUBLIC. A LINK_ONLY
 * row lives in the same table and is invisible here: it is reachable solely through
 * `public.share_by_token`, which requires the token.
 *
 * Ownership is checked against `portfolios` rather than a `user_id` column, so a published row
 * cannot be written for a portfolio the caller does not own even though the table has no user_id
 * of its own.
 */
create policy "public shares are world-readable" on public.published_shares
  for select
  using (visibility = 'PUBLIC');

create policy "published shares are owner-writable" on public.published_shares
  for all
  using (
    exists (
      select 1 from public.portfolios p
      where p.id = published_shares.portfolio_id and p.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.portfolios p
      where p.id = published_shares.portfolio_id and p.user_id = (select auth.uid())
    )
  );

create policy "share links are self-readable"   on public.portfolio_share_links
  for select using ((select auth.uid()) = user_id);
create policy "share links are self-insertable" on public.portfolio_share_links
  for insert with check ((select auth.uid()) = user_id);
-- Revocation is an update of revoked_at, which is why this exists at all; the token hash itself is
-- never rewritten.
create policy "share links are self-updatable"  on public.portfolio_share_links
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "share links are self-deletable"  on public.portfolio_share_links
  for delete using ((select auth.uid()) = user_id);

create policy "snapshots are self-readable"   on public.share_snapshots
  for select using ((select auth.uid()) = user_id);
create policy "snapshots are self-insertable" on public.share_snapshots
  for insert with check ((select auth.uid()) = user_id);
-- **No update policy.** A snapshot is immutable; RLS denies what it does not permit.
create policy "snapshots are self-deletable"  on public.share_snapshots
  for delete using ((select auth.uid()) = user_id);

create policy "share events are self-readable"   on public.share_events
  for select using ((select auth.uid()) = user_id);
create policy "share events are self-insertable" on public.share_events
  for insert with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------- token-gated reads

/*
 * Resolving a share link.
 *
 * `security definer` because the caller is anonymous and must not be able to see the link table —
 * being able to list it would turn "guess a 256-bit token" into "read a column". The function
 * returns only the published payload, and only when the link is neither expired nor revoked, so a
 * wrong hash and a revoked hash are indistinguishable to the caller: both return no rows.
 *
 * It also records the access, which is why it is volatile rather than stable. That write is the
 * whole of Stockly's viewer analytics: a counter and a timestamp on the owner's own link row.
 *
 * `search_path` is pinned. A definer function that resolves an unqualified name through a
 * caller-controlled path is the classic privilege-escalation shape.
 */
create function public.share_by_token(p_token_hash text)
returns table (payload jsonb, published_at timestamptz, visibility public.share_visibility)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_portfolio uuid;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return;
  end if;

  update public.portfolio_share_links
     set access_count = access_count + 1,
         last_accessed_at = now()
   where token_hash = p_token_hash
     and revoked_at is null
     and (expires_at is null or expires_at > now())
  returning portfolio_id into v_portfolio;

  if v_portfolio is null then
    return;
  end if;

  -- A link to a portfolio the owner has since set back to PRIVATE resolves to nothing. Revocation
  -- is therefore two independent switches, either of which closes the door.
  return query
    select s.payload, s.published_at, s.visibility
      from public.published_shares s
     where s.portfolio_id = v_portfolio;
end;
$$;

/*
 * Resolving a snapshot. Same reasoning, minus the access counter: a snapshot is a frozen artefact
 * and counting reads of it would be analytics for its own sake.
 */
create function public.snapshot_by_token(p_token_hash text)
returns table (payload jsonb, version integer, label text, calculated_at timestamptz, created_at timestamptz)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select s.payload, s.version, s.label, s.calculated_at, s.created_at
    from public.share_snapshots s
   where p_token_hash ~ '^[0-9a-f]{64}$'
     and s.token_hash = p_token_hash;
$$;

-- Definer functions are executable by everyone by default; make the grant explicit and revoke the
-- ability to call them with anything but the intended signature.
revoke all on function public.share_by_token(text) from public;
revoke all on function public.snapshot_by_token(text) from public;
grant execute on function public.share_by_token(text) to anon, authenticated;
grant execute on function public.snapshot_by_token(text) to anon, authenticated;

comment on table public.portfolio_shares is
  'Sharing configuration. Every show_* column defaults to false: a section is visible because the '
  'owner enabled it, never because a column was added.';
comment on table public.published_shares is
  'The only table an anonymous role can read. Holds a pre-filtered PublicPortfolio document, never '
  'a portfolio — no transaction, no user id, no email can be reached from here.';
comment on table public.portfolio_share_links is
  'Capability tokens. Only the SHA-256 is stored; the raw token is shown once, at creation.';
comment on table public.share_snapshots is
  'Immutable frozen projections. No update policy exists, deliberately. Distinct from '
  'portfolio_snapshots, which is the daily value series the performance chart reads.';
comment on function public.share_by_token(text) is
  'Resolves a share link to its published payload. security definer so an anonymous caller can '
  'present a token without being able to read the link table.';
