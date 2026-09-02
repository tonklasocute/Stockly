-- Phase 9: multi-market and multi-currency.
--
-- Forward-only and additive. **No column is added, renamed or dropped** — every one this phase
-- needs already exists, which is why an application that was US-only can start recording Thai
-- trades without a data rewrite:
--
--   transactions.market        text not null default 'US'   (20260901000000_init)
--   dividends.market/currency  text not null defaults        (20260901020000_analytics)
--   cash_transactions.currency text not null default 'USD'   (20260901020000_analytics)
--   watchlist_items.market     text not null default 'US'    (20260901010000_watchlist)
--   alerts.market              text not null default 'US'    (20260901030000_alerts)
--   technical_snapshots.market part of the primary key        (20260901040000_technical)
--   portfolios.currency        text not null default 'USD'   (20260901000000_init)
--
-- So what is left is the part that was only ever enforced in TypeScript: `transactions.market`
-- accepted any string (`alerts`, `dividends` and `watchlist_items` have been constrained since the
-- phases that added them), and `portfolios.currency` accepted any three capital letters including
-- ones the app cannot price. This migration moves those rules into the database, where CLAUDE.md
-- says a rule belongs when it can be a constraint.
--
-- Every existing row satisfies every constraint below: the defaults are 'US' and 'USD', and the
-- currency picker has only ever offered codes from the list. If one does not, the constraint will
-- refuse to be added and the offending row is the bug — see docs/PRODUCTION-RUNBOOK.md.

-- ---------------------------------------------------------------- markets are a closed set
--
-- The same `check (market in (...))` that `dividends`, `watchlist_items` and `alerts` already
-- carry, applied to the one table that was missing it. A market Stockly cannot price must not be
-- storable: a row with market = 'XETRA' would be routed to a US provider and silently valued in the
-- wrong currency, which is exactly the failure this phase exists to make impossible.
--
-- Adding a market means editing this constraint, `domain/market.ts` and the three constraints that
-- already exist — deliberately several places, because a market the database accepts and the
-- provider router cannot serve is a row that can never be priced.

alter table public.transactions
  add constraint transactions_market_known check (market in ('US', 'SET'));

-- ---------------------------------------------------------------- portfolio base currency
--
-- `portfolios.currency` IS the base currency: the one every total, chart and summary on a
-- portfolio's pages is denominated in, and the target every holding is translated into. It is not
-- renamed — a rename would break rollback for no gain — but it is now documented and constrained.
--
-- The set matches domain/market.ts. USD and THB can be priced and converted today; the rest are
-- accepted so a portfolio can be kept in them, and render "N/A" until an FX rate exists, which is
-- the honest answer rather than a fabricated conversion.

comment on column public.portfolios.currency is
  'Base currency: what every figure on this portfolio''s pages is denominated in. Holdings keep '
  'their own currency and are translated into this one at today''s rate. See domain/market.ts.';

alter table public.portfolios
  add constraint portfolios_currency_known
    check (currency in ('USD', 'THB', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD'));

alter table public.dividends
  add constraint dividends_currency_known
    check (currency in ('USD', 'THB', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD'));

alter table public.cash_transactions
  add constraint cash_currency_known
    check (currency in ('USD', 'THB', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD'));

-- ---------------------------------------------------------------- snapshot currency
--
-- The one place phase 9 does add a column, and it closes a real hole rather than enabling a feature.
--
-- `portfolio_snapshots` is the only figure Stockly cannot recompute later: portfolio VALUE on a past
-- day needs a market price for that day, which the provider's free tier cannot supply. Every stored
-- row is denominated in the portfolio's base currency at the moment it was written — so a user who
-- switches a portfolio from USD to THB would find last month's rows thirty-two times smaller than
-- this month's, and a performance chart with a cliff in it that no amount of explanation removes.
--
-- Recording the currency makes that impossible: the chart reads only the rows written in the
-- currency it is being shown in, and switching base currency starts a fresh series rather than
-- corrupting the old one. The old rows are kept, not deleted — they are still true about the
-- currency they were taken in.
--
-- Default 'USD' is exact for every existing row: a snapshot could only ever have been written by a
-- portfolio whose base currency was USD, because that was the only one the app supported.

alter table public.portfolio_snapshots
  add column currency text not null default 'USD';

alter table public.portfolio_snapshots
  add constraint portfolio_snapshots_currency_known
    check (currency in ('USD', 'THB', 'EUR', 'GBP', 'JPY', 'SGD', 'HKD'));

comment on column public.portfolio_snapshots.currency is
  'The base currency this row was recorded in. The performance chart reads only the rows matching '
  'the portfolio''s current base currency, so changing it starts a new series instead of producing '
  'a chart that mixes two units.';

-- The unique constraint stays on (portfolio_id, snapshot_date): one row per portfolio per day, in
-- whatever the base currency is that day. Adding currency to it would let a portfolio accumulate two
-- rows for the same day after a switch, and the chart would then have to decide which is real.

-- ---------------------------------------------------------------- indexes the new queries need
--
-- Replaying a portfolio now groups by (symbol, market) rather than symbol alone, and the screener's
-- universe resolver reads (symbol, market) from three tables. Both existing indexes lead on the
-- columns that actually narrow the scan, so only the transactions one is worth widening.

drop index if exists public.transactions_symbol_idx;
create index transactions_instrument_idx
  on public.transactions (portfolio_id, market, symbol);

-- The snapshot refresh reads every 1D row and orders by age; the screener reads all of them. The
-- primary key already covers (symbol, market, timeframe), so no new index is needed there.

comment on column public.transactions.market is
  'The venue this trade happened on, and therefore the currency of price and fee. Currency is '
  'derived from the market rather than stored, so the two can never disagree.';

comment on column public.cash_transactions.currency is
  'Stored, not derived: one portfolio can hold balances in more than one currency at once.';

comment on column public.dividends.currency is
  'Stored, not derived: a listing can pay in a currency other than the one it trades in.';
