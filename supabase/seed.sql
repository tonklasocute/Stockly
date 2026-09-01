-- Development seed. NEVER run against production.
--
--   1. Register the user in the app (or Supabase Studio) first — this script does not create auth users.
--   2. Run it, overriding the email:
--        psql "$DATABASE_URL" -v email=you@example.com -f supabase/seed.sql
--
-- Mock prices for these symbols live in services/market-data/mock-provider.ts
-- (NVDA 180, AAPL 210, SOFI 14), so the dashboard shows real numbers from the real engine.

\set ON_ERROR_STOP on
\if :{?email}
\else
  \set email dev@stockly.local
\endif

-- Fails loudly ("no rows returned") if that user does not exist yet.
select id as seed_user_id from auth.users where email = :'email' \gset

delete from public.portfolios
 where user_id = :'seed_user_id' and name = 'My Portfolio';

with p as (
  insert into public.portfolios (user_id, name, currency)
  values (:'seed_user_id', 'My Portfolio', 'USD')
  returning id, user_id
)
insert into public.transactions
  (portfolio_id, user_id, symbol, side, trade_date, quantity, price, fee, notes)
select p.id, p.user_id, v.symbol, v.side::public.transaction_side,
       current_date - v.days_ago, v.quantity, v.price, v.fee, v.notes
  from p
 cross join (values
   ('NVDA', 'buy',  120,  10, 170, 1.5, 'Initial position'),
   ('AAPL', 'buy',  100,  20, 200, 1.5, null),
   ('SOFI', 'buy',   80, 100,  12, 1.0, null),
   ('SOFI', 'sell',  20,  20,  15, 1.0, 'Trimmed'),
   ('MSFT', 'buy',   90,   4, 400, 1.0, null)
 ) as v(symbol, side, days_ago, quantity, price, fee, notes);

delete from public.watchlist_items where user_id = :'seed_user_id';

insert into public.watchlist_items (user_id, symbol, market, name, exchange, target_price)
values
  (:'seed_user_id', 'PLTR', 'US', 'Palantir Technologies Inc.', 'NASDAQ', 140),
  (:'seed_user_id', 'AMD',  'US', 'Advanced Micro Devices, Inc.', 'NASDAQ', null),
  (:'seed_user_id', 'TSLA', 'US', 'Tesla, Inc.', 'NASDAQ', 220);

-- Cash and dividends, so analytics has something to work with out of the box.
delete from public.cash_transactions where user_id = :'seed_user_id';
delete from public.dividends where user_id = :'seed_user_id';

with p as (
  select id, user_id from public.portfolios
   where user_id = :'seed_user_id' and name = 'My Portfolio'
)
insert into public.cash_transactions (portfolio_id, user_id, kind, amount, occurred_on, notes)
select p.id, p.user_id, v.kind::public.cash_transaction_kind, v.amount,
       current_date - v.days_ago, v.notes
  from p
 cross join (values
   ('deposit',    10000, 150, 'Initial funding'),
   ('deposit',     2500,  60, 'Monthly contribution'),
   ('withdrawal',   500,  15, 'Withdrew some profit')
 ) as v(kind, amount, days_ago, notes);

with p as (
  select id, user_id from public.portfolios
   where user_id = :'seed_user_id' and name = 'My Portfolio'
)
insert into public.dividends
  (portfolio_id, user_id, symbol, payment_date, shares, dividend_per_share, tax, fee, notes)
select p.id, p.user_id, v.symbol, current_date - v.days_ago, v.shares, v.dps, v.tax, 0, v.notes
  from p
 cross join (values
   ('AAPL',  95, 20, 0.25, 0.08, 'Q1'),
   ('AAPL',   5, 20, 0.26, 0.08, 'Q2'),
   ('MSFT',  70,  4, 0.83, 0.10, null)
 ) as v(symbol, days_ago, shares, dps, tax, notes);

select
  (select count(*) from public.transactions      where user_id = :'seed_user_id') as transactions,
  (select count(*) from public.watchlist_items   where user_id = :'seed_user_id') as watchlist,
  (select count(*) from public.cash_transactions where user_id = :'seed_user_id') as cash,
  (select count(*) from public.dividends         where user_id = :'seed_user_id') as dividends;
