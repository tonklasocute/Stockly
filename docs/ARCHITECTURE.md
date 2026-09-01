# Stockly — Architecture

Companion to `CLAUDE.md`. This file explains *why* the structure is the way it is. Update it when a
decision here stops being true.

## 1. System shape

```
Browser / installed PWA
  └─ Next.js (Vercel)
       ├─ Server Components ──────────┐
       ├─ Route Handlers (/api/**) ───┼─→ domain/     (pure calculations)
       │                              ├─→ Supabase    (Postgres + Auth + RLS)
       │                              └─→ services/market-data → external quote provider
       └─ Client Components + TanStack Query
```

One deployable. No separate backend service, no queue, no cache layer — none of it is needed at
personal-portfolio scale, and all of it can be added behind the boundaries below.

## 2. The central decision: transactions are the source of truth

Holdings are **derived**, not stored as a mutable row that must be kept in sync.

```
transactions (buy/sell)  ─┐
cash_transactions        ─┼─→ derived: holdings, avg cost, realized P&L, cash balance
dividends                ─┘
                              + live quotes → market value, unrealized P&L, return %, weight
```

Why: a stored `holdings` table has to be updated correctly on every insert, edit, delete and backdated
transaction. Every such system eventually drifts, and reconciling a portfolio's cost basis after the
fact is miserable. Deriving is always correct by construction.

**Implementation (phase 1):** `domain/holdings.ts` replays a portfolio's transactions in trade order
and returns positions, priced holdings and a summary. It is a pure function — no database, no React —
so every rule about fees, partial sells and re-buys is covered by unit tests rather than by clicking
around the UI. `features/portfolios/portfolio-view.ts` is the single caller: read rows, fetch quotes,
run the engine. Every page uses it, so the dashboard and the portfolio page cannot disagree.

The engine lives in TypeScript rather than in a SQL view (as phase 0 sketched) for one reason: the
numbers users argue about must be testable in isolation, and duplicating the cost-basis rules in SQL
would mean maintaining them twice.

**Upgrade path:** a portfolio is a few hundred rows, so replaying it per request costs nothing. If a
portfolio ever grows to tens of thousands of transactions, cache the computed positions per portfolio
and invalidate on write. `ponytail:` ceiling — recompute every time until it measurably hurts.

**Cost basis method:** weighted average cost (not FIFO/LIFO). It is what retail trackers show and what
Thai/US retail brokers report. Realized P&L on a sell = `proceeds − (avgCostAtSale × qty) − fees`. If
FIFO is ever needed for tax reporting, it becomes a second function in `domain/`, not a schema change.

## 3. Layers and the rules between them

| Layer | May import | Must not import |
|---|---|---|
| `domain/` | nothing but its own types | React, Next, Supabase, fetch, env |
| `services/` | domain, lib | React, feature code |
| `app/api/**` | domain, services, lib, feature schemas | React components |
| `features/` | domain, lib, components | other features' internals |
| `components/` | lib | features, domain, services |

`domain/` staying pure is what makes the numbers testable and what would make a future extraction
(Go service, background job, CSV importer) cheap. It is the one boundary worth being strict about.

## 4. Data model

```
auth.users (Supabase)
  └─ portfolios          id, user_id, name, base_currency, created_at
       ├─ transactions   id, portfolio_id, user_id, symbol, market, side(buy|sell),
       │                 trade_date, quantity numeric, price numeric, fee numeric, note
       ├─ cash_transactions  id, portfolio_id, user_id, kind(deposit|withdrawal),
       │                     amount numeric, occurred_at, note
       └─ dividends      id, portfolio_id, user_id, symbol, pay_date,
                         amount_per_share numeric, quantity numeric, tax numeric

       ├─ dividends      id, portfolio_id, user_id, symbol, payment_date, shares,
       │                  dividend_per_share, tax, fee, currency, notes
       ├─ cash_transactions  id, portfolio_id, user_id, kind(deposit|withdrawal),
       │                     amount, currency, occurred_on, notes
       └─ portfolio_snapshots  id, portfolio_id, user_id, snapshot_date, total_value,
                               invested_value, cash_value, realized_pnl, unrealized_pnl
                               unique (portfolio_id, snapshot_date)

watchlist_items   id, user_id, symbol, market, name, exchange, target_price, notes
                  unique (user_id, market, symbol)
```

Planned but not built: `alerts` (phase 5).

`dividends` carries no ex-date or record-date: Stockly records payments actually received, and
neither date affects any figure it computes. `cash_transactions.amount` is always positive — the
direction lives in `kind`, so one movement cannot be expressed two ways.

**No `instruments` or `quotes_cache` table.** Phase 0 sketched both; neither earned its place. The
Next Data Cache already deduplicates and expires provider responses across instances, so a database
cache would be a second cache to keep coherent, plus a table, RLS policies and a write path — for no
behaviour the HTTP cache does not already provide. `watchlist_items.name`/`exchange` are snapshots
taken at insert time: that one denormalization means the watchlist renders instantly and still lists
your stocks when the provider is down. Prices are never stored.

Notes:
- `user_id` is denormalized onto every child table so RLS policies are a single-column check with no
  joins. This is deliberate duplication.
- `symbol + market` is the instrument key everywhere; `market` exists from the start so adding SET
  later is not a migration of every row.
- All money and quantity columns are `numeric`. Never `float8`.
- `quotes_cache` and `instruments` are shared reference data, not user data — different RLS rules
  (readable by any authenticated user, writable only by the server role).

## 5. Authorization

Two layers, and the database one is authoritative:

1. **RLS** — every user table: `using (auth.uid() = user_id)`, default-deny, explicit policies per
   operation. A bug in a route handler cannot leak another user's rows.
2. **Route handlers** — resolve the session, never accept `user_id` from the request, and set it
   server-side on insert.

The service-role key bypasses RLS. It is used only in server-only code for shared reference data
(quote cache, instrument metadata) and never for anything user-scoped.

## 6. Market data

```
UI (server component or TanStack Query)
      ↓
Route handler /api/stocks/**            ← auth, validation, shared error envelope
      ↓
getMarketDataProvider()                 ← the only place a provider is named
      ↓
MarketDataProvider  (services/market-data/types.ts)
      ↓
TwelveDataProvider  ← Zod-parses the raw payload into the domain model
      ↓
fetchJson (http.ts) ← timeout, Next Data Cache, latency logging
      ↓
api.twelvedata.com
```

### Why Twelve Data

| | free tier | quote | history | search | profile |
|---|---|---|---|---|---|
| **Twelve Data** | 8 credits/min, 800/day | ✅ batch | ✅ intraday + daily | ✅ | plan-dependent |
| Finnhub | 60 calls/min | ✅ | ❌ candles are paid | ✅ | ✅ |
| Alpha Vantage | 25 requests/**day** | ✅ | ✅ | ✅ | ✅ |
| Polygon | 5 calls/min | end-of-day | ✅ | ✅ | ✅ |

The price chart is a phase 2 deliverable, and Twelve Data is the only one of these whose free tier
still serves historical series at a usable request rate. Finnhub's rate limit is far more generous
and would be the better pick if charts ever move to a paid plan — that swap is one adapter file.

### Limits that shaped the design

- **A batch quote costs one credit per symbol**, not per request. Batching saves round trips and
  latency, not quota. *Caching* is what protects the quota.
- 8 credits per minute is low. A fifty-holding dashboard would blow the per-minute budget on a single
  uncached render, so the Next Data Cache (shared across serverless instances, unlike an in-process
  Map) fronts every call. Cold starts still get a warm price.
- `/profile` is not on every plan. A 4xx there degrades to search metadata rather than failing.
- Market status comes from the provider's `market_state`, never from the browser clock.

### Cache lifetimes

| data | TTL | why |
|---|---|---|
| quote | 60s | the only thing that moves within a session |
| history, intraday (1D/1W) | 5 min | moves during the session |
| history, 1M and longer | 6 h | only changes after the close |
| symbol search | 24 h | a query's results do not change within a day |
| company profile | 24 h | near-static |

### Failure policy

Every method resolves or throws `MarketDataError`. The distinction that matters: a **missing symbol**
is `null` or `[]` (normal), while a **rate limit or outage** is an error (exceptional). A single
unknown ticker in a portfolio must not blank the dashboard; a rate limit must not be silently
mistaken for "no data", which would price the whole portfolio at cost without telling anyone.

When quotes fail, `loadPortfolioView` still returns: the engine falls back to average cost, marks
those holdings `stale`, and the page shows a banner. A portfolio tracker that shows nothing when a
third party is down is worse than one that shows cost basis and says so.

## 7. Rendering and state

- Dashboard, portfolio and stock detail pages are Server Components that fetch holdings + quotes
  server-side. Fast first paint, keys stay on the server.
- TanStack Query owns anything that refreshes or mutates (quote refresh, transaction CRUD with
  optimistic update + invalidation). Query keys are namespaced per feature.
- Zustand only for genuinely global client state (selected portfolio, theme). No global store for
  data that came from the server.

## 8. PWA

Full detail in [PWA.md](PWA.md). The decision that shaped everything else:

**The service worker caches no authenticated data — none.** Every page in Stockly is server-rendered
per user, so a cached page is another user's portfolio waiting to be replayed on a shared device. The
worker therefore skips `/api/**`, `/auth/**`, every non-GET request, every other origin, and every
navigation response. It holds exactly two things: the precached `/offline` page with the icons, and
content-hashed `_next/static` output.

That is also why it is hand-written rather than generated. A runtime-caching plugin's defaults are
tuned for content sites; here a wrong default is a data leak, and the whole worker is 120 lines.

Quote and history caching stays on the **server**, in the Next Data Cache, where entries are keyed by
request rather than by device and no session is involved.

Versioning: registered as `/sw.js?v=<APP_VERSION>`. A changed URL is a different worker, so a release
rolls out on its own and `lib/version.ts` remains the single source of truth — no build step rewrites
`sw.js`. Updates are offered, never forced; reloading mid-form would discard the user's input.

`ponytail:` ceiling — move to Serwist only if precaching manifests or navigation preload become
necessary. Neither is today.

## 9. Watchlist

One implicit list per user — `watchlist_items` keyed by `(user_id, market, symbol)` — rather than
`watchlists` + `watchlist_items`. Named lists are speculative; adding a `list_id` later is a
migration, not a redesign. The unique constraint, not application code, is what prevents duplicates;
the API only translates `23505` into a sentence.

## 10. What phase 1 actually shipped

`profiles`, `portfolios` and `transactions` with RLS; email/password auth via Supabase Auth;
portfolio and transaction CRUD behind Route Handlers; the calculation engine and its tests; the
dashboard, portfolio and transactions pages; the app shell with light/dark and a mobile tab bar;
manifest and icons. Prices come from `mockMarketDataProvider` behind the real `MarketDataProvider`
interface, so phase 2 swaps the implementation and nothing else.

## 11. Analytics and snapshots (phase 3)

Every formula is specified in [PORTFOLIO-CALCULATIONS.md](PORTFOLIO-CALCULATIONS.md). The three
decisions worth repeating here:

**Money precision.** `domain/money.ts` accumulates over scaled integers. `0.1 + 0.2` is exactly `0.3`
and a thousand additions of `0.01` is exactly `10`. No dependency, no rewrite of the formulas — only
the accumulation points changed. Ceiling: exact below ~$9bn at six decimal places; decimal.js if that
is ever exceeded, and every call site already goes through this one module.

**Capital flow is not performance.** A $10,000 deposit raises portfolio value by $10,000 and earns
nothing. So performance is measured as `totalValue − (investedValue + cashValue)`: a contribution
moves both sides and cancels. This is why cash is modelled at all.

**Snapshot strategy: write-on-read, daily, idempotent.**

```
analytics page renders → quotes already fetched → upsert today's snapshot
                                                   on (portfolio_id, snapshot_date)
```

Not a cron: a nightly job would fan out over every portfolio of every user and need a quote per
symbol — at 8 credits a minute that job cannot finish, for users who may not open the app that week.
Not on-transaction: a portfolio's value moves with the market, not with the user's typing, so it
would miss every day nobody traded.

Write-on-read costs nothing extra and captures a day exactly when the user cared about it. A snapshot
is skipped when market data failed or any holding is stale, so a fallback valuation is never baked
into history. `ponytail:` ceiling — history only accumulates on days the user visits; a Vercel Cron
route calling the same idempotent upsert is the upgrade, and nothing else changes.

The consequence, stated in the UI rather than hidden: the performance chart starts the first time
analytics is opened. Invested capital and P&L need no history and are exact from the first
transaction.

## 12. Cache invalidation

There is no stored aggregate. Pages recompute from Supabase on every request, so invalidation means
re-rendering routes, and it lives in one place — `lib/cache.ts`. `invalidatePortfolio()` revalidates
dashboard, portfolio, transactions, analytics, dividends and cash together, because they all derive
from the same rows. Market-data responses are cached separately by tag, so a new transaction does not
discard a quote that is still fresh.

## 13. What phase 2 added

`MarketDataProvider` with a Twelve Data adapter and the mock kept as a first-class option (the app is
fully usable with `MARKET_DATA_PROVIDER=mock` and no account); `lib/env.server.ts` so the key cannot
reach the browser bundle; global ⌘K stock search, debounced; `/stocks/[symbol]` with a live quote
header, a range-switching price chart, overview metrics, company profile and your position;
`watchlist_items` with CRUD; today's P&L across the dashboard and portfolio; and cost-basis fallback
with a stale banner when the provider is unavailable.

Symbols are normalised through `lib/symbol.ts` and keyed by `market:symbol`, so adding SET later does
not collide with a US ticker of the same name. `market` and `currency` are on every relevant row, but
no FX conversion is performed — a portfolio reports in its own currency only.

## 14. What phase 3 added

`domain/money.ts`, `cash.ts`, `dividends.ts` and `analytics.ts`, all pure and tested;
`dividends`, `cash_transactions` and `portfolio_snapshots` with RLS; dividend and cash CRUD; the
analytics page (performance, allocation, sector/industry/country/currency, concentration, movers,
contribution, trade and fee statistics); CSV export; server-side pagination; and a shared date-range
control that every dated view reads from the URL.

`services/benchmark/types.ts` defines `BenchmarkProvider` and the rebasing rule, with **no
implementation and no UI** — index series (^GSPC, ^IXIC, SET) are not on the provider's free tier, and
a chart that can never load is worse than an absent one. The shape is settled now because that is the
part that would be expensive to change later.

## 15. Alerts and notifications (phase 5)

Full detail in [ALERTS.md](ALERTS.md). Three decisions shaped everything else:

**Firing on a crossing, not a comparison.** `current > target` is true on every poll while the price
sits above the target, so it would notify every five minutes. The engine keeps a state per alert
(`armed → triggered`, back to `armed` only when the condition goes false), which also survives a
missed run or a restart in a way that comparing two raw prices does not.

**One batched call per run.** The job collects the union of every enabled alert's symbol and makes a
single request. A thousand alerts on NVDA across a hundred users is one upstream call; the naive
nested loop would be ten thousand and would exhaust a free tier in seconds.

**Push payloads are public data only.** Prices and percentage moves are named — a notification that
will not say what happened is useless — but portfolio value, return and position weight never appear.
The text can be shown on a locked screen to whoever is holding the device.

The service-role key appears here for the first time, in `lib/supabase/admin.ts`. It bypasses RLS,
which the job needs (it reads alerts belonging to everyone and has no session), and it is reachable
only from behind the cron secret. Every interactive path still goes through the request-scoped client.

`DIVIDEND_RECEIVED` is raised from the write that creates the dividend rather than polled: the event
is a row appearing, and a cron would have to diff the table against itself to notice.

## 16. Technical analysis and the screener (phase 6)

Full detail in [TECHNICAL-ANALYSIS.md](TECHNICAL-ANALYSIS.md). The decisions that shaped it:

**Indicators are pure and index-aligned.** Every series comes back the same length as its input with
`null` for the warm-up, because crossing detection compares index *i* against *i−1* across two
different indicators — dropping warm-up values would silently shift them apart. RSI is verified
against Wilder's published worked example rather than against a screenshot.

**The screener's universe is what this deployment already tracks**, and that is a data-source
consequence stated plainly rather than hidden. Indicators need an OHLCV history: one request per
symbol, no batching, eight a minute on the free tier. Screening five thousand names would take ten
hours and twenty times the daily quota. So the universe is holdings + watchlist + alerted symbols +
a default list, capped at 60, cached in `technical_snapshots` by the scheduled job.

That cache is what makes the feature affordable at all: running a screen costs a database query and
**zero upstream requests**, however often a user presses the button.

**Filters are closed enums, never expressions.** `{ metric, operator, value }`, validated by Zod and
looked up in a table. There is no field a client can put SQL or JavaScript into, because there is no
field that is ever interpreted — an unrecognised metric reads as `null` and matches nothing.

**Technical alerts reuse the phase 5 engine unchanged.** The neat part is the cross types: their
reading is 1 on the bar the cross happened and 0 otherwise, against a target of 0.5, so the existing
`armed → triggered` rule fires exactly once per event with no special case anywhere.

`technical_snapshots` is the first table of **shared reference data**: NVDA's RSI is the same for
every user, so it is computed once and readable by any signed-in user, written only by the job.

## 17. What is deliberately not here yet

FX conversion, FIFO cost basis, time- and money-weighted return, benchmark comparison, SET listings,
a market-wide screener universe, price prediction of any kind, email and LINE notification channels,
offline mutation queues, CSV import, an event bus, and any Go service. Each has a clear insertion
point above; none is built until the phase that needs it.
