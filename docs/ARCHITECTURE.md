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

watchlist_items   id, user_id, symbol, market, name, exchange, target_price, notes
                  unique (user_id, market, symbol)
```

Planned but not built: `alerts` (phase 5).

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

- `app/manifest.ts` (Next.js native) — no plugin needed for the manifest.
- Phase 1 ships the manifest, icons, `apple-touch-icon`, theme colour and `viewport-fit=cover` only.
  No service worker yet — that is phase 4, and an unversioned one caching an authenticated app is
  worse than none.
- When it arrives: precache the shell and static assets, network-first for pages, an offline fallback
  route, and **never cache authenticated API responses** — a stale portfolio value is worse than no
  value. `ponytail:` ceiling — move to Serwist if precaching and versioning get fiddly.
- iOS specifics: `apple-touch-icon` (the manifest icons are ignored), `viewport-fit=cover`, and
  `env(safe-area-inset-bottom)` on the bottom navigation.

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

## 11. What phase 2 added

`MarketDataProvider` with a Twelve Data adapter and the mock kept as a first-class option (the app is
fully usable with `MARKET_DATA_PROVIDER=mock` and no account); `lib/env.server.ts` so the key cannot
reach the browser bundle; global ⌘K stock search, debounced; `/stocks/[symbol]` with a live quote
header, a range-switching price chart, overview metrics, company profile and your position;
`watchlist_items` with CRUD; today's P&L across the dashboard and portfolio; and cost-basis fallback
with a stale banner when the provider is unavailable.

Symbols are normalised through `lib/symbol.ts` and keyed by `market:symbol`, so adding SET later does
not collide with a US ticker of the same name. `market` and `currency` are on every relevant row, but
no FX conversion is performed — a portfolio reports in its own currency only.

## 12. What is deliberately not here yet

FX conversion, FIFO cost basis, SET listings, background jobs, push notifications, CSV import,
sector allocation, an event bus, and any Go service. Each has a clear insertion point above; none is
built until the phase that needs it.
