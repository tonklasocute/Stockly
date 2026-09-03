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
       │                              ├─→ services/market-data → external quote provider
       │                              └─→ services/ai          → LLM provider (optional, off by default)
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

Symbols are normalised and keyed by `market:symbol`, so a SET listing never collides with a US ticker
of the same name — the identity `lib/symbol.ts` established in phase 2 and phase 9 relies on
throughout. `market` and `currency` were put on every relevant row here; phase 9 is what finally
reads them (§18).

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

## 17. The AI research assistant (phase 7)

Full detail in [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md). Four decisions shaped it:

**The model writes prose; it never produces a number.** The schema it fills in has five text fields
and no numeric one. Price, RSI, ADX, the technical score and every component, portfolio value,
weights and returns are retrieved from the engines that own them and rendered *beside* the generated
text, not inside it. A hallucinated figure is not unlikely here; it is unrepresentable. That single
choice removed most of the risk the rest of the feature would otherwise have had to manage.

**The model gets no tools.** Retrieval runs to completion, under the caller's own session, before a
token is generated. So the honest answer to "can a prompt injection read another user's portfolio"
is that there is nothing to read it with — not that the prompt discourages it.

**AI sits above the source of truth, never beside it.** `services/market-data` still owns prices,
`technical_snapshots` still owns indicators, `scoreTechnicals` still owns the score breakdown,
`loadAnalytics` still owns portfolio figures, `matchesFilter` still owns pass/fail. The assistant
reads all five and computes none of them, so it cannot disagree with the dashboard.

**Natural language produces a proposal, not an execution.** The screener translator returns
`{ metric, operator, value }` through the phase-6 enums; the user sees the filters and presses Run.
The same rule governs alerts: the assistant can describe the supported conditions, and creating one
is still the existing dialog.

`services/ai/` mirrors `services/market-data/` exactly — one interface, adapters behind it, one
`switch` naming a vendor, `server-only` on the module that reads the key. Anthropic uses the official
SDK, because it already implements the timeout, the bounded retry and the typed errors; the
OpenAI-compatible adapter is one `fetch`, because that shape is spoken by four vendors and by every
local model, and a second SDK for one request body would be a dependency bought for nothing.

There is deliberately **no answer cache**: an answer depends on a question, a portfolio, live prices
and a snapshot timestamp, and a key that missed one of those would serve yesterday's prices as
today's. What was expensive was already cached before phase 7 — quotes for 60s, indicators on a
schedule.

The whole feature is behind `AI_ENABLED`, default off. With it off, nothing else changes, and the
production build succeeds either way.

## 18. Multi-market and multi-currency (phase 9)

Full detail in [`MULTI-MARKET.md`](MULTI-MARKET.md). The four decisions that shape everything else:

1. **A market is a row in a registry, never an `if` in a call site.** `domain/market.ts` carries each
   market's currency, timezone, exchanges, sessions, holidays and symbol grammar. Adding Tokyo is a
   row here plus one in an adapter's `PROVIDER_MARKET` table; no domain function changes.
2. **Currency is derived from the market**, not stored beside it — `market = 'US', currency = 'THB'`
   must not be representable. Cash and dividends are the deliberate exceptions, because a portfolio
   really can hold two balances and a listing really can pay in another currency.
3. **Native figures are exact; base-currency figures are a translation.** `Holding.marketValue` is in
   the instrument's currency and is never null; `Holding.baseMarketValue` is in the portfolio's and
   **is** null when no rate exists. `returnPct` is a ratio of two same-currency figures, so no rate
   can move it — stock performance is never contaminated by a currency's.
4. **Missing FX is `null`, never 0 and never 1.** A total that had to exclude a holding reports
   `untranslatedCount`, and the page says so. `fxEffect` is typed `null` because separating currency
   movement from stock performance needs the rate on every past trade date, and Stockly stores none.

The pieces:

- `services/market-data/index.ts` routes by market — `getQuotesFor` makes **one batched call per
  market**, and a market whose provider fails is named in `failed` while the others still return.
  Everything per-instrument (quotes, snapshots, alert readings, position weights) is keyed by
  `symbolKey` (`"SET:PTT"`), because a bare symbol is unique only inside one market.
- `services/fx/` mirrors it: an interface, a mock, a Twelve Data adapter on `/exchange_rate`, and one
  place that chooses. Every method resolves — a provider outage degrades a figure to "N/A", never a
  page to an error. `loadFxTable` costs **one request per currency pair per ten minutes** for the
  whole deployment; a single-currency portfolio costs none.
- `domain/calendar.ts` answers "is this market open?" in the market's own timezone via `Intl`, and
  answers `"unknown"` past its verified holiday horizon rather than guessing "open". The provider's
  reported status always wins over it.
- **Technical analysis stays native.** An RSI is a shape in a price history; converting the series
  first would fold the exchange rate into the indicator. Snapshots are shared reference data, so they
  could not be per-portfolio-currency even if that were desirable.

The migration adds **no columns** — every one already existed, defaulted to `'US'`/`'USD'`. What it
adds are the `check` constraints that were previously only enforced in TypeScript.

## 19. Investment intelligence (phase 10)

Full detail in [`INTELLIGENCE.md`](INTELLIGENCE.md). The decisions that matter:

1. **The intelligence layer is downstream of the engine and never upstream of it.** Journals,
   theses, goals and benchmarks record what a calculation cannot — reasoning and targets. None is an
   input to a financial figure, and `domain/intelligence-boundary.test.ts` reads the source of every
   calculation module to keep it that way. Deleting every row phase 10 added leaves holdings, cost
   basis and P&L byte-identical.
2. **No derived figure is stored.** Goal progress, returns and risk are re-derived from
   `loadAnalytics` on every request, so a goal cannot disagree with the dashboard and a stale
   progress row cannot exist to be wrong.
3. **A deposit is not a return.** `domain/returns.ts` removes external capital on both sides —
   time-weighted for anything compared against a benchmark, money-weighted (IRR, by bisection) when
   the question is what this investor earned. `domain/risk.ts` reads the flow-adjusted index, never
   portfolio value, so a deposit cannot disguise a drawdown.
4. **Insights are rules, not a model.** `domain/insights.ts` applies documented thresholds to
   figures the engine produced. Every sentence it can emit is checked against a forbidden-vocabulary
   list by a test — no buy, sell, rating, target or forecast — and every rule produces nothing when
   its input is null. AI reads this output; it never produces it.
5. **Only the user judges their own reasoning.** The system puts a measurement beside a thesis and
   stops. Deciding one is broken would be a sell recommendation with extra steps.

One `loadIntelligence` pass, `cache()`d over the already-cached `loadAnalytics`, serves the
dashboard, the review page and the AI context — so the whole layer costs no extra pass over the
transactions and no extra quote call.

## 20. Planning and simulation (phase 11)

Full detail in [`SIMULATION.md`](SIMULATION.md). The decisions that matter:

1. **A simulation is arithmetic on assumptions the user chose, never a prediction.** The vocabulary
   carries it — `scenarioPrice`, `projectedGap`, `annualReturn` — and every result travels with the
   assumptions that produced it.
2. **The engine cannot reach anything.** `domain/simulation/` has no database client, no network, no
   model and no framework import; a test reads its source to keep it that way. Because it is pure it
   runs in the **browser**, so a slider moves and the numbers move with it — there is no simulation
   endpoint to build, rate-limit or debounce.
3. **One growth engine.** `simulateGrowth` is the only compounding in the codebase; phase 10's
   separate projection was deleted rather than kept beside it. The closed form is implemented too,
   for the required-contribution solver to invert, and a test asserts the two agree to nine decimal
   places.
4. **Nothing it produces can be stored as a result.** `saved_simulations` holds inputs; every figure
   is recomputed on open. There is no projected-value column to go stale.
5. **Actual and projected are never mixed.** Four labels — ACTUAL, PROJECTED, SCENARIO, ASSUMPTION —
   applied consistently, projections drawn dashed, and an assumptions panel that is neither hidden
   nor collapsible on every screen that shows one.

`invariants.test.ts` runs every simulation against a full portfolio and asserts holdings, cost basis,
realised and unrealised P&L and cash come back byte-identical. Transactions remain the single source
of truth; a simulation cannot create one.

## 21. Data import and automation (phase 12)

Full detail in [`IMPORT.md`](IMPORT.md). The decisions that matter:

1. **An imported row is an ordinary transaction.** Import writes to `transactions` and stops. The
   same engine derives holdings, cost basis and P&L afterwards as before — there is no import-side
   holdings model, no staging table that becomes authoritative, nothing that can drift.
2. **Preview is stateless and the file is never stored.** Parsing happens in the request that
   received the bytes; nothing is written until the user confirms. That makes the side-effect
   property provable rather than argued, avoids keeping a stranger's brokerage statement for an
   import they abandoned, and needs no filesystem Vercel does not have.
3. **Idempotency belongs to the database.** A partial unique index on
   `(user_id, import_fingerprint)` is the guarantee; the fingerprint pre-query is one query for the
   whole portfolio and only an optimisation. The fingerprint is a canonical string, not a hash — a
   collision would silently skip a real trade.
4. **A conflict is shown, never resolved.** When a row carries a broker reference the reference is
   the identity, so a corrected row re-imports as a duplicate and reconciliation reports the
   difference. Stockly does not quietly rewrite a number the user owns.
5. **No dependency for the file formats.** `lib/csv.ts` gained a parser beside its writer, and
   `lib/xlsx.ts` reads a workbook with `node:zlib` — values only, never formulas, every inflated
   entry size-capped. The npm alternative carries advisories `npm run audit:ci` would fail on.
6. **Automation is bounded and observable.** `/api/cron/data` reuses the alerts secret, skips closed
   markets, batches one call per market and writes counters — never figures — to `job_executions`.

`domain/import/invariants.test.ts` asserts a preview leaves holdings, cost basis, P&L and cash
byte-identical, that applying only ever adds transactions, that re-applying the same file is a no-op,
and — structurally, by reading the source — that nothing in `domain/import/` can reach a client, a
network or a framework.

## 22. Sharing and snapshots (phase 13)

Full detail in [`SHARING.md`](SHARING.md). The decisions that matter:

1. **Sharing is a projection, not a portfolio.** An anonymous visitor never reads portfolio data.
   They read a jsonb document the owner's own session produced through
   `domain/sharing.ts:projectPublicPortfolio`, already filtered by their settings.
2. **Which is why there is no privileged read.** The service-role key stays unreachable from a
   request, as it has since phase 5. The anonymous role's whole grant is `select` on
   `published_shares where visibility = 'PUBLIC'`, plus two `security definer` functions that
   require a token — so there is no path from an anonymous request to a `transactions` row, and a
   bug in the projector can leak at most what the owner published.
3. **The cost is stated rather than hidden.** A shared page is as fresh as the last publish and
   prints when that was. Calling it "live" would be the exact dishonesty the freshness fields
   elsewhere in this codebase exist to prevent. It also makes a public page one indexed row read —
   no engine pass, no quote call — which is what makes a link posted to social media survivable.
4. **Everything defaults to off, and withheld is not null.** An absent key means the owner did not
   share it; `null` keeps its usual meaning of "not computable" and renders `N/A`.
5. **A token is a capability**: 32 CSPRNG bytes, stored only as SHA-256, shown once. Expiry and
   revocation are evaluated inside the same statement that reads the row, and token pages are never
   cached.
6. **The preview is the real page** — same projection, same component — because a preview rendered
   by different code can be wrong about what a stranger sees.

`domain/sharing-leak.test.ts` walks the actual published document across every combination of
settings, checking by key and by value; `domain/sharing-boundary.test.ts` asserts holdings, cost
basis, P&L and cash are byte-identical after every sharing operation and that no calculation module
imports the sharing layer. `supabase/sharing-policies.test.ts` reads the migration and fails if a
policy, a pinned `search_path` or the missing snapshot update policy ever changes.

## 23. Personalization (phase 15)

Full detail in [`personalization.md`](personalization.md). The decisions that matter:

1. **A preference decides what is displayed, never what is calculated.** The fourth one-way boundary
   in this codebase, after intelligence, simulation and sharing, and proved the same way: every
   personalization operation runs against a real portfolio and the financial state comes back
   byte-identical.
2. **`domain/personalization.ts` imports nothing at all.** A widget is an id and a position; a
   metric is a pointer to a figure the engine already produced. There is no arithmetic in the file
   and a test asserts there is none.
3. **Four tables, not eight.** Five per-user documents that are read and written together and never
   queried by their contents are columns on one row, size-capped by check constraints. Only tags and
   saved views — the things actually queried and joined — get tables of their own.
4. **Ten widgets do not cost ten requests.** Every widget renders from the same single
   `loadIntelligence` pass the dashboard always made; the layout decides order and visibility, never
   how many times the engine runs.
5. **A stored layout is reconciled against the registry on read and on write**, so a release that
   adds or removes a widget can never leave anyone with a broken or rearranged dashboard.
6. **Nothing personal can reach a shared page**, because `ShareSource` declares no field for it.

## 24. Historical intelligence and attribution (phase 16)

Full detail in [`performance-attribution.md`](performance-attribution.md). The decisions that
matter:

1. **Reconstruction is a filter plus the existing engine.** `reconstructAt` hands the transactions
   up to a date to the same `replayPortfolio` and `computeCash` the dashboard calls, so a figure
   about March cannot disagree with what March's dashboard showed — and a test asserts that
   reconstructing today reproduces today exactly.
2. **A snapshot stores only what cannot be recomputed.** Quantities, cost basis, realised P&L and
   cash are exact from transactions on demand; a *price on a past day* is not, and that asymmetry is
   the entire reason `portfolio_snapshots` exists and the reason it holds so little.
3. **Attribution is money-weighted, and says so.** `weight × return` assumes a constant weight,
   which stops being true the moment somebody trades — and recording that is the point of the app.
   Contributions are measured in money against the same removed flows the portfolio's own gain uses,
   so the parts sum to the whole arithmetically rather than by construction.
4. **The residual is displayed, never distributed.** Stockly stores no per-holding price history, so
   a position held unchanged through a period is under-measured; the gap is shown with the holdings
   that caused it rather than scaled away.
5. **FX attribution is typed `null`.** It needs a rate for every day of the period. `fx_rates_daily`
   begins accumulating them, which makes the capability possible forward and leaves it honestly
   unavailable for every period before it.
6. **Drawdowns read the flow-adjusted index**, so a deposit cannot look like a recovery.

`domain/history-invariants.test.ts` runs every historical operation against a live portfolio and
asserts the transaction set and every financial figure come back byte-identical, plus the structural
rule that the three new engines import only from `domain/`.

## 25. Fundamentals and corporate events (phase 17)

Full detail in [`FUNDAMENTALS.md`](FUNDAMENTALS.md). The decisions that matter:

1. **The phase ships with no vendor behind it, deliberately.** Twelve Data's free tier supplies no
   financial statements, so `FUNDAMENTALS_PROVIDER` defaults to `none` and the default provider
   declares zero capabilities. A "Twelve Data" adapter returning empty arrays would make a coverage
   gap indistinguishable from a company that reports nothing; a mock in production would render
   synthetic revenue as real accounts.
2. **`capabilities` is part of the provider contract**, which is the one difference from
   `MarketDataProvider`. Fundamental coverage is wildly uneven, and a UI that asks and receives
   nothing cannot otherwise tell "no data" from "not covered".
3. **Reference data about a company, never a fact about a user.** No `user_id` on either table, no
   reference to `transactions`, and no portfolio id in any engine signature. An event is a notice
   and never becomes a transaction.
4. **The engines refuse more than they compute.** No P/E for a loss, no growth from a negative base,
   no quarter compared against a year, no TTM from three quarters, no multiple across a currency
   mismatch, and no forward estimate — which has no field rather than a null one.
5. **Fundamental filters live in the existing screener's enum**, and an unknown value excludes a
   stock from both sides of a comparison.

## 26. What is deliberately not here yet

Monte Carlo and any other distribution of outcomes, portfolio optimisation and efficient frontiers,
automatic execution of any kind, historical FX rates and therefore FX attribution, triangulated
exchange rates, more than one currency per market, FIFO cost basis and tax lots, tax modelling,
automatic thesis invalidation, a composite risk score,
multiple benchmarks per portfolio, full-text journal search, a market-wide screener universe, price prediction of any kind, email and LINE notification channels, offline
mutation queues, broker API connections, scheduled unattended imports, stored original upload files,
broker-specific import presets, a public portfolio directory, public profiles or search, likes,
comments, followers and every other social feature, shared transactions, journals or simulations,
dynamic Open Graph image generation, live (rather than published) public pages, portfolio-to-portfolio
comparison, a portfolio event timeline, a user-level display-currency override, drag-and-drop widget
reordering, per-instrument daily price history and therefore full FX and Brinson attribution,
market-history backfill, a fundamental quality score, forward estimates, Brinson attribution, a
stock comparison screen, fundamental alerts, earnings-quality signals, an event bus, any Go service, streamed AI responses, an AI answer cache,
and any autonomous action taken on a user's behalf. Each has a clear insertion point above; none is
built until the phase that needs it.
