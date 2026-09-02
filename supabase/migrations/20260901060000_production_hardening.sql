-- Phase 8: production hardening — database-level integrity the application was only assuming.
--
-- Forward-only, additive, and safe to apply to a populated database *provided no row already
-- violates the new constraints*. A row that does violate one is a row created by the bug this
-- migration closes; see docs/PRODUCTION-RUNBOOK.md for the query that finds them.

-- ---------------------------------------------------------------- portfolio ownership
--
-- The gap: every child table carries both `portfolio_id` and `user_id`, RLS checks only `user_id`,
-- and `user_id` is set from the session. Nothing tied the two together — so a request could insert
-- a transaction of its own carrying somebody else's `portfolio_id`, and the database would accept
-- it. RLS hid the row from the portfolio's owner, which made it an integrity problem rather than a
-- disclosure, but "isolation that depends on application code" is exactly what CLAUDE.md forbids.
--
-- The fix is structural: a composite foreign key on (portfolio_id, user_id). A child row can now
-- only reference a portfolio belonging to the same user, and no route handler has to remember to
-- check. This is the same reasoning that put `user_id` on these tables in the first place.
--
-- MATCH SIMPLE (the default) skips the check when any referencing column is null, which is what
-- alerts.portfolio_id needs: a portfolio-wide alert has no portfolio, and that stays legal.

alter table public.portfolios
  add constraint portfolios_id_user_key unique (id, user_id);

alter table public.transactions
  drop constraint transactions_portfolio_id_fkey,
  add constraint transactions_portfolio_fkey
    foreign key (portfolio_id, user_id)
    references public.portfolios (id, user_id) on delete cascade;

alter table public.dividends
  drop constraint dividends_portfolio_id_fkey,
  add constraint dividends_portfolio_fkey
    foreign key (portfolio_id, user_id)
    references public.portfolios (id, user_id) on delete cascade;

alter table public.cash_transactions
  drop constraint cash_transactions_portfolio_id_fkey,
  add constraint cash_transactions_portfolio_fkey
    foreign key (portfolio_id, user_id)
    references public.portfolios (id, user_id) on delete cascade;

alter table public.portfolio_snapshots
  drop constraint portfolio_snapshots_portfolio_id_fkey,
  add constraint portfolio_snapshots_portfolio_fkey
    foreign key (portfolio_id, user_id)
    references public.portfolios (id, user_id) on delete cascade;

alter table public.alerts
  drop constraint alerts_portfolio_id_fkey,
  add constraint alerts_portfolio_fkey
    foreign key (portfolio_id, user_id)
    references public.portfolios (id, user_id) on delete cascade;

-- ---------------------------------------------------------------- conversation ownership
--
-- The same rule for phase 7: a message must belong to a conversation owned by the same user.

alter table public.ai_conversations
  add constraint ai_conversations_id_user_key unique (id, user_id);

alter table public.ai_messages
  drop constraint ai_messages_conversation_id_fkey,
  add constraint ai_messages_conversation_fkey
    foreign key (conversation_id, user_id)
    references public.ai_conversations (id, user_id) on delete cascade;

-- ---------------------------------------------------------------- indexes the audit found missing
--
-- Added only where a query in the application actually filters or sorts this way. An index that no
-- query uses is a write cost with no read benefit.

-- The notification centre lists unread first, per user, newest first. Partial: read notifications
-- are the overwhelming majority over time and are never the thing being counted.
create index if not exists notifications_unread_idx
  on public.notifications (user_id, created_at desc)
  where read_at is null;

-- The alert job scans enabled alerts and collects the union of their symbols. Partial again:
-- a disabled alert is never evaluated, so it does not belong in the index.
create index if not exists alerts_enabled_symbol_idx
  on public.alerts (symbol)
  where enabled and symbol is not null;

-- Dividend and cash pages both page by date within a portfolio; the existing indexes cover those.
-- The AI usage quota counts a rolling window per user, which ai_usage_user_time_idx already covers.
