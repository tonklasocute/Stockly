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
   ('SOFI', 'sell',  20,  20,  15, 1.0, 'Trimmed')
 ) as v(symbol, side, days_ago, quantity, price, fee, notes);

select count(*) as seeded_transactions from public.transactions where user_id = :'seed_user_id';
