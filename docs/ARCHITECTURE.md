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

## 4. Data model (initial)

```
auth.users (Supabase)
  └─ portfolios          id, user_id, name, base_currency, created_at
       ├─ transactions   id, portfolio_id, user_id, symbol, market, side(buy|sell),
       │                 trade_date, quantity numeric, price numeric, fee numeric, note
       ├─ cash_transactions  id, portfolio_id, user_id, kind(deposit|withdrawal),
       │                     amount numeric, occurred_at, note
       └─ dividends      id, portfolio_id, user_id, symbol, pay_date,
                         amount_per_share numeric, quantity numeric, tax numeric

watchlist_items   id, user_id, symbol, market, target_buy_price, note
alerts            id, user_id, symbol, kind(price|target_buy|stop_loss|take_profit),
                  threshold numeric, active bool, triggered_at
instruments       symbol, market, name, sector, currency        -- cached metadata
quotes_cache      symbol, market, price, change, change_pct, as_of  -- short-lived
```

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

```ts
interface MarketDataProvider {
  getQuote(symbol: string, market: Market): Promise<Quote>
  getHistoricalPrices(symbol: string, market: Market, range: Range): Promise<Candle[]>
  searchSymbol(query: string): Promise<InstrumentSummary[]>
  getCompanyProfile(symbol: string, market: Market): Promise<CompanyProfile>
}
```

- Exactly one implementation to begin with; the provider is chosen in one place in
  `services/market-data/index.ts`. The rest of the app depends only on the interface.
- Provider responses are Zod-parsed at the boundary — free APIs return nulls and surprises.
- Server-side only. The client asks our route handler, which holds the key and can cache and
  rate-limit. Quotes are cached briefly (`quotes_cache`) so one page render is one upstream call.
- Free tiers have hard rate limits. Batch symbols where the provider supports it; degrade to stale
  cached prices with an `as_of` timestamp rather than failing the page.

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

## 9. What phase 1 actually shipped

`profiles`, `portfolios` and `transactions` with RLS; email/password auth via Supabase Auth;
portfolio and transaction CRUD behind Route Handlers; the calculation engine and its tests; the
dashboard, portfolio and transactions pages; the app shell with light/dark and a mobile tab bar;
manifest and icons. Prices come from `mockMarketDataProvider` behind the real `MarketDataProvider`
interface, so phase 2 swaps the implementation and nothing else.

## 10. What is deliberately not here yet

Multi-currency conversion, FIFO cost basis, background jobs, push notifications, CSV import,
sector allocation, an event bus, a caching layer, and any Go service. Each has a clear insertion
point above; none is built until the phase that needs it.
