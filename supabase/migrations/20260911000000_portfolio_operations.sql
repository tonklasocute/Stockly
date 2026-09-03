-- Phase 19: advanced portfolio operations — reconciliation, audit, share adjustments, transfers.
--
-- The rule this migration is built around, and the one to check any future change against:
--
--   **External data verifies the portfolio. It never replaces its source of truth.**
--
-- Nothing added here can move a number on its own. A reconciliation run is a *reading*: two sides
-- compared, differences described, causes listed. A share adjustment is a stored fact applied in
-- front of the existing engine, not a rewrite of anybody's transactions. An audit row is written by
-- the database itself and can be read but never altered. The only things that still change a
-- financial figure are the tables that always did: transactions, cash_transactions, dividends.
--
-- Forward-only and additive. No existing column changes type, no existing row is touched, and every
-- new table is empty on deploy — so a rollback of the application code needs no schema change.

-- ---------------------------------------------------------------- the wider cash ledger
--
-- Phase 3 shipped two kinds because two were all a hand-entered portfolio needed. A broker
-- statement carries more, and a fee that has nowhere to go becomes a cash difference nobody can
-- explain — which is exactly what reconciliation exists to eliminate.
--
-- The direction of each kind lives in `domain/cash.ts` (`CASH_FLOW_DIRECTION`), and the separation
-- between capital flows and outcomes lives beside it (`CAPITAL_FLOW_KINDS`). That distinction is
-- what keeps a deposit from being read as a profit, and it is deliberately NOT encoded here: a
-- check constraint that duplicated it would be a second place for it to drift.
--
-- `add value` only. Removing an enum value would orphan stored rows, so the set only ever grows.

alter type public.cash_transaction_kind add value if not exists 'fee';
alter type public.cash_transaction_kind add value if not exists 'tax';
alter type public.cash_transaction_kind add value if not exists 'interest';
alter type public.cash_transaction_kind add value if not exists 'transfer_in';
alter type public.cash_transaction_kind add value if not exists 'transfer_out';
alter type public.cash_transaction_kind add value if not exists 'adjustment_in';
alter type public.cash_transaction_kind add value if not exists 'adjustment_out';

-- Provenance for a movement that a reconciliation produced, so "why does this row exist?" has an
-- answer that is not a note somebody typed. Null for everything entered by hand, which is the
-- overwhelming majority.
alter table public.cash_transactions
  add column source text not null default 'MANUAL',
  add column source_reference text;

alter table public.cash_transactions
  add constraint cash_source_known
    check (source in ('MANUAL', 'IMPORT', 'RECONCILIATION', 'TRANSFER', 'CORPORATE_ACTION')),
  add constraint cash_source_reference_length
    check (source_reference is null or length(source_reference) <= 200);

comment on column public.cash_transactions.source is
  'Where this movement came from. A reconciliation-created row says so, so an adjustment can never '
  'be mistaken for something the user recorded themselves.';

-- The same provenance on the transaction table. Phase 12 added import provenance; this adds the
-- rest, so an adjustment or a transferred row explains itself without a join.
alter table public.transactions
  add column source text not null default 'MANUAL',
  add column source_reference text;

alter table public.transactions
  add constraint transactions_source_known
    check (source in ('MANUAL', 'IMPORT', 'RECONCILIATION', 'TRANSFER', 'CORPORATE_ACTION')),
  add constraint transactions_source_reference_length
    check (source_reference is null or length(source_reference) <= 200);

-- ---------------------------------------------------------------- audit trail
--
-- **Written by the database, never by a route handler.**
--
-- An audit trail a request can choose not to write is not an audit trail. This one is a trigger on
-- the two tables that hold money, so every path — the API, an import, a correction, a transfer, a
-- psql session — produces a row, and no future endpoint can forget to.
--
-- It records the row before and the row after. Not a diff: a diff is an interpretation, and the
-- thing an auditor needs is the two states. Deleting a portfolio deletes its transactions, which
-- writes DELETE rows here describing exactly what was removed.

create table public.financial_audit (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  /*
   * Deliberately NOT a foreign key, and neither is `entity_id`.
   *
   * An audit row outlives the thing it describes — that is its entire purpose. A reference would
   * make the record of a deletion impossible to write, because the row it describes is gone by the
   * time the trigger fires.
   */
  portfolio_id uuid,
  entity       text not null,
  entity_id    uuid not null,
  operation    text not null,
  -- The whole row, before and after. `before` is null on an insert, `after` null on a delete.
  before       jsonb,
  after        jsonb,
  -- Set by the correction and transfer functions; null for an ordinary edit, which is honest.
  reason       text,
  source       text not null default 'MANUAL',
  occurred_at  timestamptz not null default now(),

  constraint financial_audit_entity_known check (entity in ('TRANSACTION', 'CASH_TRANSACTION')),
  constraint financial_audit_operation_known check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  constraint financial_audit_source_known
    check (source in ('MANUAL', 'IMPORT', 'RECONCILIATION', 'TRANSFER', 'CORPORATE_ACTION', 'CORRECTION')),
  constraint financial_audit_reason_length check (reason is null or length(reason) <= 500),
  -- An insert has no before and a delete has no after; anything else is a trigger bug.
  constraint financial_audit_states_match_operation check (
    (operation = 'INSERT' and before is null and after is not null) or
    (operation = 'UPDATE' and before is not null and after is not null) or
    (operation = 'DELETE' and before is not null and after is null)
  )
);

create index financial_audit_entity_idx on public.financial_audit (entity, entity_id, occurred_at desc);
create index financial_audit_portfolio_idx on public.financial_audit (portfolio_id, occurred_at desc);
create index financial_audit_user_idx on public.financial_audit (user_id, occurred_at desc);

comment on table public.financial_audit is
  'Every change to a money-bearing row, before and after, written by a trigger. Readable by its '
  'owner and writable by nobody: there is no insert, update or delete policy, and RLS denies what '
  'it does not permit.';

/*
 * The trigger.
 *
 * `security definer` so it can write to a table the caller has no insert policy on — that asymmetry
 * is the guarantee. `reason` and `source` are read from transaction-local settings, which only the
 * correction and transfer functions below set, and which cannot survive into another request.
 */
create or replace function public.record_financial_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_entity text := case tg_table_name when 'transactions' then 'TRANSACTION' else 'CASH_TRANSACTION' end;
  v_reason text := nullif(current_setting('stockly.audit_reason', true), '');
  v_source text := coalesce(nullif(current_setting('stockly.audit_source', true), ''), 'MANUAL');
  v_before jsonb;
  v_after  jsonb;
  v_user   uuid;
  v_folio  uuid;
  v_id     uuid;
begin
  -- Branched rather than coalesced: OLD is unassigned during an INSERT and NEW during a DELETE,
  -- and referencing either one then is an error rather than a null.
  if tg_op = 'INSERT' then
    v_after := to_jsonb(new); v_user := new.user_id; v_folio := new.portfolio_id; v_id := new.id;
  elsif tg_op = 'DELETE' then
    v_before := to_jsonb(old); v_user := old.user_id; v_folio := old.portfolio_id; v_id := old.id;
  else
    v_before := to_jsonb(old); v_after := to_jsonb(new);
    v_user := new.user_id; v_folio := new.portfolio_id; v_id := new.id;
  end if;

  insert into public.financial_audit (
    user_id, portfolio_id, entity, entity_id, operation, before, after, reason, source
  ) values (
    v_user, v_folio, v_entity, v_id, tg_op, v_before, v_after,
    left(v_reason, 500),
    -- An unrecognised setting must not fail the write it is describing.
    case when v_source in ('MANUAL','IMPORT','RECONCILIATION','TRANSFER','CORPORATE_ACTION','CORRECTION')
         then v_source else 'MANUAL' end
  );
  return null;
end;
$$;

create trigger transactions_audit
  after insert or update or delete on public.transactions
  for each row execute function public.record_financial_audit();

create trigger cash_transactions_audit
  after insert or update or delete on public.cash_transactions
  for each row execute function public.record_financial_audit();

-- ---------------------------------------------------------------- share adjustments
--
-- A split is the one corporate action that changes a derived number with no transaction behind it.
-- Recording it as a buy would invent a purchase, a cost basis and a realized P&L; rewriting the
-- stored transactions would destroy the record of what the user actually did. So it is stored
-- separately and applied in front of the engine by `domain/corporate-actions.ts`.
--
-- Delete the row and every figure returns to what it was. That reversibility is the reason this
-- shape was chosen over the other two.

create table public.share_adjustments (
  id                 uuid primary key default gen_random_uuid(),
  portfolio_id       uuid not null references public.portfolios (id) on delete cascade,
  user_id            uuid not null references auth.users (id) on delete cascade,
  symbol             text not null,
  market             text not null,
  event_type         text not null,
  -- The first trading day the new share count applies to. Transactions strictly before it are
  -- restated; one on the day is already quoted post-split.
  effective_date     date not null,
  numerator          numeric(20, 8) not null,
  denominator        numeric(20, 8) not null,
  -- The notice this was applied from, when there was one. Set null on delete: the adjustment is a
  -- decision the user made and outlives the reference data that prompted it.
  corporate_event_id uuid references public.corporate_events (id) on delete set null,
  note               text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint share_adjustments_type_known check (event_type in ('SPLIT', 'REVERSE_SPLIT')),
  constraint share_adjustments_market_known check (market in ('US', 'SET')),
  constraint share_adjustments_symbol_format
    check (symbol = upper(symbol) and length(symbol) between 1 and 20),
  -- A ratio of zero on either side would erase a position or divide by nothing.
  constraint share_adjustments_numerator_positive check (numerator > 0),
  constraint share_adjustments_denominator_positive check (denominator > 0),
  -- A 1:1 split changes nothing and would only be a row to misread later.
  constraint share_adjustments_ratio_not_identity check (numerator <> denominator),
  constraint share_adjustments_note_length check (note is null or length(note) <= 500),
  -- Applying the same split twice would square the ratio. The database refuses, rather than the
  -- application remembering to.
  constraint share_adjustments_once
    unique (portfolio_id, symbol, market, effective_date),
  constraint share_adjustments_portfolio_fkey
    foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index share_adjustments_portfolio_idx
  on public.share_adjustments (portfolio_id, effective_date);
create index share_adjustments_user_idx on public.share_adjustments (user_id);

create trigger share_adjustments_touch_updated_at
  before update on public.share_adjustments
  for each row execute function public.touch_updated_at();

comment on table public.share_adjustments is
  'A split the user confirmed, applied in front of the replay engine. Transactions are never '
  'rewritten; deleting this row restores every figure exactly.';

-- ---------------------------------------------------------------- reconciliation history

/*
 * One row per reconciliation run.
 *
 * `source_label` is free text rather than a foreign key to a broker-account table, and that is a
 * decision rather than an omission: an account entity would need CRUD, ownership, and a UI, and
 * would answer exactly the question this column answers — which statement was this. It earns a
 * table the day a portfolio genuinely holds two accounts.
 *
 * The summary is counts. No figure from the portfolio is stored here: every number the report
 * displays is re-derived from the items, so a run cannot go stale or disagree with the dashboard.
 */
create table public.reconciliation_runs (
  id           uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  source_label text not null,
  period_start date,
  period_end   date,
  status       text not null default 'PENDING',
  summary      jsonb not null default '{}'::jsonb,
  started_at   timestamptz not null default now(),
  completed_at timestamptz,
  -- A short sentence. Never a stack trace, never a provider's response body.
  error        text,
  created_at   timestamptz not null default now(),

  constraint reconciliation_runs_status_known check (status in (
    'PENDING', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'
  )),
  constraint reconciliation_runs_label_length check (length(btrim(source_label)) between 1 and 120),
  constraint reconciliation_runs_period_ordered
    check (period_start is null or period_end is null or period_start <= period_end),
  constraint reconciliation_runs_summary_size check (length(summary::text) <= 4000),
  constraint reconciliation_runs_error_length check (error is null or length(error) <= 500),
  -- A run that failed produced no findings; anything else is a bookkeeping bug.
  constraint reconciliation_runs_failed_has_reason
    check (status <> 'FAILED' or error is not null),
  constraint reconciliation_runs_portfolio_fkey
    foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade
);

create index reconciliation_runs_portfolio_idx
  on public.reconciliation_runs (portfolio_id, started_at desc);
create index reconciliation_runs_user_idx on public.reconciliation_runs (user_id, started_at desc);

/*
 * One finding.
 *
 * `transaction_id` is deliberately not a foreign key: a finding that says "this transaction looks
 * like a duplicate" must stay readable after the user acts on it and deletes the transaction. The
 * id is a pointer for the UI, and a missing target is itself information.
 *
 * `detail` holds the two sides and the candidate causes, exactly as `domain/reconciliation.ts`
 * produced them. Bounded, because a jsonb column with no cap is a place for a whole statement to
 * end up by accident.
 */
create table public.reconciliation_items (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.reconciliation_runs (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  scope          text not null,
  status         text not null,
  symbol         text,
  market         text,
  currency       text,
  transaction_id uuid,
  detail         jsonb not null default '{}'::jsonb,
  -- Set when the user has dealt with the finding. A resolved item is kept, never deleted: the
  -- record that a difference existed is the point.
  resolved_at    timestamptz,
  resolution     text,
  created_at     timestamptz not null default now(),

  constraint reconciliation_items_scope_known check (scope in ('TRANSACTIONS', 'POSITIONS', 'CASH')),
  constraint reconciliation_items_status_length check (length(status) between 1 and 40),
  constraint reconciliation_items_market_known check (market is null or market in ('US', 'SET')),
  constraint reconciliation_items_currency_format
    check (currency is null or currency ~ '^[A-Z]{3}$'),
  constraint reconciliation_items_detail_size check (length(detail::text) <= 4000),
  constraint reconciliation_items_resolution_known
    check (resolution is null or resolution in ('ADJUSTED', 'IGNORED', 'EXPLAINED')),
  -- A resolution and its timestamp are one fact and must arrive together.
  constraint reconciliation_items_resolution_paired
    check ((resolved_at is null) = (resolution is null))
);

create index reconciliation_items_run_idx on public.reconciliation_items (run_id, scope, status);
create index reconciliation_items_user_idx on public.reconciliation_items (user_id);
create index reconciliation_items_unresolved_idx
  on public.reconciliation_items (run_id)
  where resolved_at is null;

comment on table public.reconciliation_items is
  'A described difference between a statement and the portfolio. It is a reading, not an '
  'instruction: nothing downstream applies one, and a change happens only when a user approves it.';

-- ---------------------------------------------------------------- correction
--
-- An ordinary PATCH already writes an audit row; what it cannot carry is *why*. PostgREST sends
-- each request as its own transaction, so a reason set by a separate call would never reach the
-- trigger. Doing the update inside one function is what puts the two in the same transaction.
--
-- `security definer` means RLS does not apply, so the `user_id = auth.uid()` predicate below is the
-- ownership check. It is not optional and it is not a belt-and-braces extra — remove it and this
-- function becomes an IDOR.

create or replace function public.correct_transaction(
  p_id         uuid,
  p_symbol     text,
  p_market     text,
  p_side       public.transaction_side,
  p_trade_date date,
  p_quantity   numeric,
  p_price      numeric,
  p_fee        numeric,
  p_notes      text,
  p_reason     text
)
returns public.transactions
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.transactions;
begin
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a correction must state a reason' using errcode = '22023';
  end if;

  -- Transaction-local: it applies to the update below and cannot leak into another request.
  perform set_config('stockly.audit_reason', btrim(p_reason), true);
  perform set_config('stockly.audit_source', 'CORRECTION', true);

  update public.transactions
     set symbol     = upper(btrim(p_symbol)),
         market     = p_market,
         side       = p_side,
         trade_date = p_trade_date,
         quantity   = p_quantity,
         price      = p_price,
         fee        = p_fee,
         notes      = p_notes
   where id = p_id
     and user_id = (select auth.uid())
  returning * into v_row;

  if not found then
    raise exception 'transaction not found' using errcode = 'P0002';
  end if;

  return v_row;
end;
$$;

revoke all on function public.correct_transaction(uuid, text, text, public.transaction_side, date, numeric, numeric, numeric, text, text) from public;
grant execute on function public.correct_transaction(uuid, text, text, public.transaction_side, date, numeric, numeric, numeric, text, text) to authenticated;

-- ---------------------------------------------------------------- transfer
--
-- Moving a holding between two of the user's own portfolios.
--
-- **A transfer re-parents the transactions. It does not sell and re-buy.**
--
-- That is the whole design. Quantity, cost basis, acquisition dates, fees, currency and market are
-- preserved because the rows are the same rows; nothing is recomputed, so nothing can drift. A
-- synthesised sell-and-buy pair would book a realized profit or loss that nobody made, and it would
-- be indistinguishable downstream from one that was actually earned.
--
-- Both portfolios are checked against `auth.uid()` — with `security definer`, that check is the
-- only thing standing between this function and moving somebody else's money.

create or replace function public.transfer_instrument(
  p_from_portfolio uuid,
  p_to_portfolio   uuid,
  p_symbol         text,
  p_market         text,
  p_reason         text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := (select auth.uid());
  v_moved integer;
begin
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_from_portfolio = p_to_portfolio then
    raise exception 'a transfer needs two different portfolios' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then
    raise exception 'a transfer must state a reason' using errcode = '22023';
  end if;

  if not exists (select 1 from public.portfolios where id = p_from_portfolio and user_id = v_user)
     or not exists (select 1 from public.portfolios where id = p_to_portfolio and user_id = v_user)
  then
    raise exception 'portfolio not found' using errcode = 'P0002';
  end if;

  perform set_config('stockly.audit_reason', btrim(p_reason), true);
  perform set_config('stockly.audit_source', 'TRANSFER', true);

  /*
   * The whole history of the instrument moves, or none of it does.
   *
   * Moving only the open shares would split one weighted-average cost basis across two portfolios
   * and leave the realized P&L of past sells attached to the wrong one. `p_symbol` null moves every
   * instrument, which is how a whole portfolio is transferred.
   */
  update public.transactions
     set portfolio_id = p_to_portfolio,
         source = 'TRANSFER'
   where portfolio_id = p_from_portfolio
     and user_id = v_user
     and (p_symbol is null or (symbol = upper(btrim(p_symbol)) and market = p_market));

  get diagnostics v_moved = row_count;

  -- Split adjustments belong to the instrument, not to the portfolio it currently sits in. Moving
  -- them with it is what keeps the restated share count correct on the other side.
  update public.share_adjustments
     set portfolio_id = p_to_portfolio
   where portfolio_id = p_from_portfolio
     and user_id = v_user
     and (p_symbol is null or (symbol = upper(btrim(p_symbol)) and market = p_market));

  return v_moved;
end;
$$;

revoke all on function public.transfer_instrument(uuid, uuid, text, text, text) from public;
grant execute on function public.transfer_instrument(uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------- row level security

alter table public.financial_audit       enable row level security;
alter table public.share_adjustments     enable row level security;
alter table public.reconciliation_runs   enable row level security;
alter table public.reconciliation_items  enable row level security;

/*
 * **Read-only, to everyone, forever.**
 *
 * The owner may read their audit trail and nothing more. There is no insert policy because the
 * trigger is `security definer` and does not need one; there is no update or delete policy because
 * a financial audit trail a user can edit is not a financial audit trail. RLS denies what it does
 * not permit, so the absence of those three policies *is* the protection.
 */
create policy "audit rows are self-readable" on public.financial_audit
  for select using ((select auth.uid()) = user_id);

create policy "share adjustments are self-readable"   on public.share_adjustments
  for select using ((select auth.uid()) = user_id);
create policy "share adjustments are self-insertable" on public.share_adjustments
  for insert with check ((select auth.uid()) = user_id);
create policy "share adjustments are self-updatable"  on public.share_adjustments
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "share adjustments are self-deletable"  on public.share_adjustments
  for delete using ((select auth.uid()) = user_id);

create policy "reconciliation runs are self-readable"   on public.reconciliation_runs
  for select using ((select auth.uid()) = user_id);
create policy "reconciliation runs are self-insertable" on public.reconciliation_runs
  for insert with check ((select auth.uid()) = user_id);
create policy "reconciliation runs are self-updatable"  on public.reconciliation_runs
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "reconciliation runs are self-deletable"  on public.reconciliation_runs
  for delete using ((select auth.uid()) = user_id);

create policy "reconciliation items are self-readable"   on public.reconciliation_items
  for select using ((select auth.uid()) = user_id);
create policy "reconciliation items are self-insertable" on public.reconciliation_items
  for insert with check ((select auth.uid()) = user_id);
create policy "reconciliation items are self-updatable"  on public.reconciliation_items
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "reconciliation items are self-deletable"  on public.reconciliation_items
  for delete using ((select auth.uid()) = user_id);

/*
 * Nothing here reaches a shared page.
 *
 * The anonymous role's entire grant in this schema is still one select on `published_shares`, and
 * `ShareSource` in `domain/sharing.ts` declares no field for a reconciliation, an audit row or an
 * adjustment — so a projection cannot carry one, because it is never handed one.
 * `features/operations/privacy.test.ts` proves it by projection and by reading the source.
 */
