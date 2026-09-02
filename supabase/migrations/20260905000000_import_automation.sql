-- Phase 12: data import, reconciliation and scheduled refresh.
--
-- The rule this migration is built around, and the one to check any future change against:
--
--   **An import creates ordinary transactions. It does not create a second kind of holding.**
--
-- There is no imported-positions table, no imported P&L, no parallel cost basis. A row that passes
-- validation becomes a row in `public.transactions` and is replayed by the same engine as one typed
-- in by hand — so every downstream figure, from the dashboard to phase 11's simulations, updates
-- because the transaction set changed and for no other reason.
--
-- What is added is the metadata that makes an import *auditable and repeatable*: where a
-- transaction came from, and a key that stops the same file creating it twice.
--
-- Forward-only and additive.

-- ---------------------------------------------------------------- import provenance on transactions
--
-- Three nullable columns. A transaction entered by hand has all three null, which is what makes
-- "where did this come from?" answerable: a fingerprint means it was imported.

alter table public.transactions
  add column import_fingerprint text,
  add column import_session_id  uuid,
  add column source_row         integer;

comment on column public.transactions.import_fingerprint is
  'Idempotency key for an imported transaction, from domain/import/fingerprint.ts. A canonical '
  'string rather than a hash: a collision here would silently skip a real trade, and a readable '
  'key can be inspected when someone asks why a row was reported as a duplicate.';

alter table public.transactions
  add constraint transactions_fingerprint_length
    check (import_fingerprint is null or length(import_fingerprint) between 1 and 200);

-- Provenance is only meaningful together: a session id without a row number cannot be traced back
-- to a line in a file, and a row number without a session belongs to no file.
alter table public.transactions
  add constraint transactions_import_provenance
    check ((import_session_id is null) = (source_row is null));

/*
 * **This index is the idempotency guarantee.**
 *
 * Duplicate detection in `domain/import` is what the preview shows the user; this is what makes it
 * true. Two requests applying the same file concurrently both pass the in-memory check and both
 * reach the insert — only the database can settle that, and it does, with a 23505 the apply path
 * counts as a duplicate rather than an error.
 *
 * Scoped to the user rather than the portfolio because the fingerprint already contains the
 * portfolio id; including it again would be redundant and would let the same key exist twice.
 */
create unique index transactions_import_fingerprint_key
  on public.transactions (user_id, import_fingerprint)
  where import_fingerprint is not null;

-- Listing the transactions one import created, for its detail page.
create index transactions_import_session_idx
  on public.transactions (import_session_id)
  where import_session_id is not null;

-- ---------------------------------------------------------------- import sessions

/*
 * A session records an import that was **applied**. There is no PREVIEWED or CANCELLED state,
 * because a preview writes nothing at all — it is a pure function of the file and the fingerprints
 * already stored, and recording one would mean keeping a stranger's brokerage data for an import
 * they decided against.
 *
 *   APPLIED  every valid row became a transaction
 *   PARTIAL  some rows were rejected or skipped as duplicates; the rest were created
 *   FAILED   nothing was created
 */
create type public.import_status as enum ('APPLIED', 'PARTIAL', 'FAILED');

create type public.import_format as enum ('CSV', 'XLSX');

/*
 * One row per upload.
 *
 * **The uploaded file is never stored.** It is parsed in the request that received it, the rows are
 * normalized, and the bytes are dropped — so there is no bucket of other people's brokerage
 * statements to secure, expire or leak. What survives is the counts, the mapping that produced
 * them, and the rows that need attention.
 */
create table public.import_sessions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  portfolio_id   uuid not null references public.portfolios (id) on delete cascade,
  -- The name as uploaded, for the history list. Truncated, and never used as a path.
  filename       text not null,
  format         public.import_format not null,
  status         public.import_status not null,
  -- The column mapping the user confirmed, so a history entry explains how the file was read.
  mapping        jsonb not null default '[]'::jsonb,
  total_rows     integer not null default 0,
  create_count   integer not null default 0,
  duplicate_count integer not null default 0,
  reject_count   integer not null default 0,
  -- How many rows actually became transactions.
  applied_count  integer not null default 0,
  applied_at     timestamptz not null default now(),
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint import_sessions_filename_length check (length(btrim(filename)) between 1 and 255),
  constraint import_sessions_counts_non_negative check (
    total_rows >= 0 and create_count >= 0 and duplicate_count >= 0
    and reject_count >= 0 and applied_count >= 0
  ),
  -- A cap, backing up the request-size limit in lib/api.ts rather than replacing it.
  constraint import_sessions_mapping_size check (length(mapping::text) <= 4000),
  constraint import_sessions_error_length check (error is null or length(error) <= 1000),
  -- A failed import created nothing, by definition; anything else is a bookkeeping bug.
  constraint import_sessions_failed_created_nothing check (
    status <> 'FAILED' or applied_count = 0
  ),
  constraint import_sessions_portfolio_fkey
    foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index import_sessions_user_idx on public.import_sessions (user_id, created_at desc);
create index import_sessions_portfolio_idx on public.import_sessions (portfolio_id, created_at desc);

create trigger import_sessions_touch_updated_at
  before update on public.import_sessions
  for each row execute function public.touch_updated_at();

-- The provenance column points here. Added after the table exists, and ON DELETE SET NULL because
-- a transaction outlives the record of how it arrived — deleting an import must never delete money.
alter table public.transactions
  add constraint transactions_import_session_fkey
    foreign key (import_session_id) references public.import_sessions (id) on delete set null;

-- ---------------------------------------------------------------- rows needing attention
--
-- **Only the rows that did not become transactions are stored**, and only their normalized values.
-- A created row is already a transaction carrying its session id and line number, so storing it
-- again would be a second copy of the same fact. A rejected one has nowhere else to live, and is
-- what the user has to look at.

create table public.import_rows (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.import_sessions (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  row_number integer not null,
  -- 'DUPLICATE' or 'REJECT'. Created rows are not stored here; see the comment above.
  outcome    text not null,
  -- The structured issues from domain/import: code, field, severity, message.
  issues     jsonb not null default '[]'::jsonb,
  -- The normalized values, for the review table. Not the raw cells: a broker file can carry an
  -- account number, and none of it is needed to explain why a row failed.
  values     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint import_rows_outcome_known check (outcome in ('DUPLICATE', 'REJECT')),
  constraint import_rows_row_number_positive check (row_number > 0),
  constraint import_rows_issues_size check (length(issues::text) <= 4000),
  constraint import_rows_values_size check (length(values::text) <= 2000)
);

create index import_rows_session_idx on public.import_rows (session_id, row_number);
create index import_rows_user_idx on public.import_rows (user_id);

-- ---------------------------------------------------------------- job history
--
-- Extends the existing cron rather than replacing it. Phase 5's job logs to stdout, which Vercel
-- captures; this adds a queryable record so the data-quality page can say when a refresh last ran
-- and whether it worked. Counters only — never a provider payload.

create table public.job_executions (
  id            uuid primary key default gen_random_uuid(),
  job           text not null,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  status        text not null default 'RUNNING',
  processed     integer not null default 0,
  succeeded     integer not null default 0,
  failed        integer not null default 0,
  -- A short summary, never a stack trace and never a provider's response body.
  error_summary text,

  constraint job_executions_status_known check (status in ('RUNNING', 'OK', 'PARTIAL', 'FAILED')),
  constraint job_executions_job_length check (length(job) between 1 and 60),
  constraint job_executions_counts_non_negative check (
    processed >= 0 and succeeded >= 0 and failed >= 0
  ),
  constraint job_executions_error_length check (error_summary is null or length(error_summary) <= 500)
);

create index job_executions_job_idx on public.job_executions (job, started_at desc);

-- ---------------------------------------------------------------- row level security

alter table public.import_sessions enable row level security;
alter table public.import_rows     enable row level security;
alter table public.job_executions  enable row level security;

create policy "import sessions are self-readable"   on public.import_sessions
  for select using ((select auth.uid()) = user_id);
create policy "import sessions are self-insertable" on public.import_sessions
  for insert with check ((select auth.uid()) = user_id);
create policy "import sessions are self-updatable"  on public.import_sessions
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "import sessions are self-deletable"  on public.import_sessions
  for delete using ((select auth.uid()) = user_id);

create policy "import rows are self-readable"   on public.import_rows
  for select using ((select auth.uid()) = user_id);
create policy "import rows are self-insertable" on public.import_rows
  for insert with check ((select auth.uid()) = user_id);
create policy "import rows are self-deletable"  on public.import_rows
  for delete using ((select auth.uid()) = user_id);

/*
 * Job history is deployment-wide operational data, not user data: it records that a refresh ran,
 * not whose portfolio it touched. Readable by any signed-in user so the data-quality page can show
 * when prices were last refreshed; writable by nobody through a request. Only the scheduled job
 * writes here, and it holds the service-role key, which bypasses RLS.
 */
create policy "job history is readable by signed-in users" on public.job_executions
  for select using ((select auth.uid()) is not null);

comment on table public.import_sessions is
  'One row per upload. The uploaded file itself is never stored — it is parsed in the request that '
  'received it and the bytes are dropped.';
comment on table public.import_rows is
  'Only the rows that did NOT become transactions. A created row is a transaction carrying this '
  'session id and its line number.';
