# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Stockly** — personal stock portfolio tracker, delivered as a Next.js web app that is also an
installable PWA (desktop, iOS, Android). Users record buy/sell transactions, and the app derives
holdings, cost basis, P&L, allocation, dividends and cash balance from them.

Markets: US stocks first, SET (Thailand) later. Multi-portfolio from day one, multi-currency later.

**Status: Phase 9 complete.** On top of phases 1–6, phase 7 added an AI research
assistant that answers questions
about your stocks, portfolio and watchlist in plain language — grounded in Stockly's own engines,
never in the model's memory — plus a natural-language screener that proposes filters for you to
review. It ships switched off (`AI_ENABLED=false`) and every other feature works unchanged without
it. Phase 8 hardened the whole system for production: a nonce-based CSP, database-enforced
portfolio ownership, rate limits on every paid upstream, request ids and structured logging, health
probes, CI, legal pages, and the runbook to operate it. Phase 9 made markets and currencies
first-class: SET alongside US, a portfolio base currency, an FX abstraction whose missing rates are
`null` rather than fabricated, market-data routing per market, and market calendars in each market's
own timezone. See [Development Phases](#development-phases).

## Commands

```bash
npm run dev              # dev server
npm run build            # production build
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm test                 # vitest (unit)
npm test -- holdings     # a single test file / pattern
npm run verify           # lint + typecheck + test + build — exactly what CI runs
npm run test:e2e         # Playwright; needs E2E_EMAIL/E2E_PASSWORD and a running app
npm run test:e2e:install # once, to download the browser
npm run audit:ci         # runtime dependency audit, high and critical only
npm start                # serve the production build (PWA needs a real build, not `next dev`)
npx supabase gen types typescript --local > types/database.ts   # once a project exists
```

Keep this section accurate — update it in the same change that adds or renames a script.

Playwright is installed (phase 8). Its specs live in `tests/e2e/` and are the only tests that need a
running application and a real database — everything else runs without either. **Never point them at
production**: they create and delete portfolio records.

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) + React + TypeScript | Server Components by default |
| Styling | Tailwind CSS + shadcn/ui + lucide-react | shadcn components land in `components/ui/`, owned by us |
| Server state | TanStack Query | the default for anything from the network |
| Client state | Zustand | only when state is shared across unrelated trees; not a default |
| Forms | React Hook Form + Zod | one Zod schema reused by form and API route |
| Charts | Recharts | one library covers the donut and the price area chart; Lightweight Charts only earns its place when candlesticks do |
| Backend | Next.js Route Handlers | no separate service; see extraction path below |
| DB / Auth | Supabase (PostgreSQL + Auth + RLS) | RLS is the primary authorization boundary |
| Market data | Twelve Data, behind `MarketDataProvider` | free tier: 8 credits/min, 800/day, **1 credit per symbol**. Routed per market in `services/market-data/index.ts` |
| Exchange rates | `FxRateProvider` — mock, Twelve Data `/exchange_rate` | one credit per pair per 10-minute cache window; a missing rate is `null`, never a fabricated one |
| Tests | Vitest (unit). Playwright when E2E is first needed | |
| Export | Hand-written CSV writer (`lib/csv.ts`) | 20 lines, with formula-injection escaping |
| Push | `web-push` (VAPID) | RFC 8291 encryption is not something to hand-roll |
| AI | `AIProvider` — Anthropic (official SDK), OpenAI-compatible (`fetch`), mock | server-side only; `AI_ENABLED=false` by default |
| Scheduling | Vercel Cron → `/api/cron/alerts` | secret-guarded; any external scheduler works too |
| Logging | `lib/log.ts` — structured JSON on `console` | Vercel captures stdout; a logging library would add a flush problem in a function that can be frozen |
| E2E | Playwright | money paths only: the critical journey and a post-deploy smoke test |
| CI | GitHub Actions | lint · typecheck · test · build (AI off *and* on) · dependency audit · secret scan |
| Deploy | Vercel | |

**No Go microservice.** Business logic lives in `domain/` with zero framework imports so it can be
ported later if the app ever outgrows Route Handlers. Do not pre-build for that split.

## Architecture

Read `docs/ARCHITECTURE.md` before designing anything non-trivial. The decisions that matter most:

1. **Transactions are the source of truth.** Holdings, average cost and realized/unrealized P&L are
   *derived* on every request by `domain/holdings.ts`, never stored as independently mutable rows
   that can drift out of sync. `features/portfolios/portfolio-view.ts` is the only caller.
2. **Calculations live in `domain/`** — pure functions, no React, no Supabase, no `fetch`. Everything
   money-related is unit-testable without a database. UI components never compute P&L inline.
3. **Market data goes through one interface.** `services/market-data/types.ts` defines
   `MarketDataProvider`; `index.ts` picks the implementation from `MARKET_DATA_PROVIDER`. No provider
   name may appear outside that folder, and no provider payload shape may escape its adapter — every
   response is Zod-parsed into the domain model at the boundary.
   Provider calls are **server-side only**: the key is read through `lib/env.server.ts`, which imports
   `server-only`, so a client import is a build error rather than a leak.
4. **Money never accumulates through raw floats.** `domain/money.ts` sums over scaled integers;
   `sumBy` replaces `reduce((a, b) => a + b)` for anything monetary. Formulas are unchanged — only the
   accumulation points. See [`docs/PORTFOLIO-CALCULATIONS.md`](docs/PORTFOLIO-CALCULATIONS.md).
5. **Every upstream call is cached by TTL, never by component render.** `services/market-data/http.ts`
   is the single fetch, using the Next Data Cache (`next: { revalidate }`), which is shared across
   serverless instances. Quotes 60s, history 5 min–6 h, search and profiles 24 h. One batched quote
   call prices a whole portfolio.
6. **Every user-owned table carries `user_id` and has RLS enabled**, default-deny. Do not rely on
   route handlers alone to scope queries.

### Folder structure

```
app/         routes + route handlers (app/api/**). Server Components by default.
components/  shared presentational UI. components/ui/ = shadcn primitives.
features/    feature slices (portfolio/, transactions/, watchlist/, …).
             Each owns its components/, hooks/, schema.ts, api.ts. Cross-feature
             imports go through the feature's index, or the code belongs in lib/.
domain/      pure business logic. No framework imports. Heavily tested.
             market.ts (market/currency/instrument registry, symbol identity) · fx.ts (rates,
             freshness, conversion) · calendar.ts (sessions, holidays, timezones) ·
             money.ts (precision) · holdings.ts (cost basis, P&L, base-currency translation) ·
             cash.ts · dividends.ts ·
             analytics.ts (allocation, concentration, contribution, trade + fee statistics) ·
             alerts.ts (crossing + state machine) · indicators.ts · technical.ts · screener.ts ·
             ai.ts (intent, symbol validation, safety vocabulary, data coverage)
lib/         cross-cutting infra: supabase clients, env parsing, formatting, constants.
services/    external integrations behind interfaces (market-data/, fx/, ai/).
types/       shared types, generated types/supabase.ts.
supabase/    migrations/, seed.sql.
docs/        architecture and design docs.

Unit tests live next to the source as *.test.ts. Add a tests/ folder when the first E2E spec exists.
```

Deliberately **not** top-level: `hooks/`, `utils/`, `schemas/`. Hooks and schemas belong to the feature
that owns them; generic helpers belong in `lib/`. A top-level `utils/` becomes a junk drawer.

Do not create new folders or abstractions "for later". Add them when the second real use case appears.

## Coding Rules

- TypeScript `strict: true`. No `any` — use `unknown` plus narrowing. No non-null `!` on values that
  can genuinely be null.
- Business logic never lives in a component. If a component computes a number a user could dispute,
  that computation belongs in `domain/`.
- Validate all external input (request bodies, query params, market-data responses) with Zod at the
  boundary. Trust nothing from the client, including prices and totals — recompute server-side.
- Server Components by default; `'use client'` only for interactivity, and push it as far down the
  tree as possible.
- Prefer editing an existing component over adding a near-duplicate. Check `components/` and the
  feature slice before creating anything.
- Handle errors explicitly. No empty `catch`. No swallowed promise rejections.
- Money and quantities: never accumulate through JS floats across many rows. Aggregate in SQL
  (`numeric`) or via the shared helpers in `domain/`, and format only at the edge.
- A provider field that may be missing is `null`, never `0`, all the way to the UI, where it renders
  as `N/A`. A fabricated zero in a financial figure is worse than an admitted gap.
- Symbols pass through `normalizeSymbol` before they are used as a key, a query param, or a row value.

## Naming Convention

```
Components        PascalCase          PortfolioSummary.tsx
Hooks             useCamelCase        useHoldings.ts
Functions/vars    camelCase
Constants         UPPER_SNAKE_CASE
Types/interfaces  PascalCase          (no I- prefix)
Files             kebab-case, except React components (PascalCase)
Database          snake_case          tables plural, columns singular
API routes        kebab-case          /api/cash-transactions
Zod schemas       xxxSchema           createTransactionSchema
```

## Market & Currency Rules

Full detail in [`docs/MULTI-MARKET.md`](docs/MULTI-MARKET.md).

- **An instrument has a market, and a market has a native currency.** `domain/market.ts` is the
  registry; everything downstream reads `instrument.market` and `currencyOf(market)`.
- **Never hardcode market behaviour by symbol.** `if (symbol === "PTT")` is forbidden, and so is
  `if (market === "TH")` outside the registry and the provider router. Adding a market is a row in
  `MARKET_REGISTRY`, a row in an adapter's `PROVIDER_MARKET`, and a `check` constraint — no domain
  function changes.
- **Currency is derived from the market, never stored beside it.** `market = 'US', currency = 'THB'`
  must not be representable. Cash and dividends are the two deliberate exceptions, because a
  portfolio really can hold two balances and a listing really can pay in another currency.
- **Portfolio valuation uses the portfolio's base currency** (`portfolios.currency`). Holdings keep
  their own: `marketValue` is native and never null, `baseMarketValue` is translated and **is**
  nullable. Never overwrite one with the other.
- **Missing FX is `null`, never 0 and never 1.** A rate of 1 values a ฿32 stock at $32; a 0 erases a
  real position from a real total. A total that excluded a holding reports `untranslatedCount` and
  the page says so.
- **Today's rate translates today's value, and nothing else.** A stored row's numbers can never move
  because a rate did. `fxEffect` is typed `null` because separating currency movement from stock
  performance needs the rate on every past trade date, and Stockly stores none — never invent it.
- **Technical analysis uses native market prices.** An RSI is a shape in a price history; converting
  the series first folds the exchange rate into the indicator. Snapshots are shared reference data
  and cannot be denominated in any one user's currency.
- **Everything per-instrument is keyed by `symbolKey`** (`"SET:PTT"`) — quotes, snapshots, alert
  readings, position weights. A bare symbol is unique only inside one market.
- **One batched quote call per market, one FX call per currency pair.** Never one per holding. A
  market whose provider fails contributes nothing and is named; the others still return.
- Market status comes from the provider; `domain/calendar.ts` fills the gap and answers `"unknown"`
  past its verified holiday horizon rather than guessing "open". Never the browser clock.
- `market` and `currency` on a request body are closed enums, validated at the boundary and again by
  a `check` constraint. A market the app cannot price must not be storable.
- Money is formatted through `lib/format.ts` with `narrowSymbol`, so `$` and `฿` are never confused.
  A headline total uses `formatCurrencyWithCode`. Never concatenate a currency symbol by hand.

## Analytics Rules

- Every formula is specified in [`docs/PORTFOLIO-CALCULATIONS.md`](docs/PORTFOLIO-CALCULATIONS.md).
  Changing a number on screen means changing that file, the domain function and its test together.
- **A capital flow is not a return.** Deposits and withdrawals change the balance without changing
  performance; anything that measures performance subtracts invested capital on both sides.
- **Two yields, two names.** "Yield on current value" and "yield on cost" share a numerator and
  nothing else. Never label either one just "dividend yield".
- Metrics that cannot be computed honestly return `null` and render `N/A` — win rate with no sells,
  average hold time with no closed position, today's change with no previous close. Never 0.
- Provider metadata that is missing becomes "Unknown" and stays in the total. Never drop a holding
  from a chart.
- Portfolio insights describe, never advise. "Technology is 61% of your portfolio" — not "reduce your
  technology exposure".
- Colour never carries meaning alone: every gain or loss also shows its sign and its percentage.
- One aggregation per request. `loadAnalytics` is `cache()`d so a page and all its sections share one
  database pass and one batched quote call.
- Any write that changes portfolio numbers calls `invalidatePortfolio()` from `lib/cache.ts`. Do not
  scatter `revalidatePath`.
- Lists that grow without bound (transactions, dividends, cash) are paginated server-side. The
  calculation engine still reads the full history — a portfolio computed from one page would be wrong.

## Technical Analysis Rules

Full detail in [`docs/TECHNICAL-ANALYSIS.md`](docs/TECHNICAL-ANALYSIS.md).

- **Stockly describes, it never predicts.** No signal, score or label may imply an action. The signal
  vocabulary contains no buy, sell, target or guarantee, and a test enforces that.
- Indicators return an array **the same length as the input**, `null` for the warm-up. Crossing
  detection compares adjacent indices across series; dropping warm-up values breaks the alignment.
- `null` is "not computable", never 0. A stock with too little history has no RSI — it does not have
  an RSI of 0, and it is excluded from a screen rather than counted as extreme.
- Every threshold is a named constant in `THRESHOLDS`. No bare numeric literal in a scoring rule.
- The technical score is scored **out of the components that could be computed**, and every component
  carries the sentence that produced it. `SCORE_VERSION` is stored so an old score stays readable.
- **Screener filters are closed enums — metric, operator, value.** Never an expression, never a
  string the server interprets. Adding a metric means adding it to the enum and the lookup table.
- Screens run against cached snapshots and cost **zero upstream requests**. Never compute indicators
  per stock inside a request that a user can repeat.
- A snapshot older than 90 minutes is labelled delayed. Never present a cached indicator beside a
  live price without saying which is which.
- Technical alerts reuse the phase 5 engine. There is one alert engine; a new condition is a new
  reading, not a new evaluator.

## AI Rules

Full detail in [`docs/AI.md`](docs/AI.md), [`docs/AI-ARCHITECTURE.md`](docs/AI-ARCHITECTURE.md),
[`docs/AI-SECURITY.md`](docs/AI-SECURITY.md) and [`docs/AI-PROMPTS.md`](docs/AI-PROMPTS.md).

- **The model writes prose; it never produces a number.** The response schema has five text fields
  and no numeric one. Every figure on screen is retrieved from Stockly's engines and rendered from a
  structured payload beside the text. Never add a numeric field to that schema.
- **AI is an interpretation layer, never a source of truth.** Prices come from
  `services/market-data`, indicators from `technical_snapshots`, the score breakdown from
  `scoreTechnicals`, portfolio figures from `loadAnalytics`, pass/fail from `matchesFilter`. If the
  assistant and the dashboard could disagree about a number, the retrieval is wrong.
- **Stockly AI describes; it never advises and never predicts.** No buy, sell, hold, rating, price
  target, forecast or guarantee. Stated in the system prompt *and* enforced by `FORBIDDEN_PATTERNS`
  after generation — a prompt is a request, a check is a guarantee. A non-compliant reply is
  rewritten once, then the text is withheld and the data is published on its own.
- **A missing reading is `null` and renders as "unavailable", all the way into the prompt.** A model
  handed `RSI: 0` will describe a stock as maximally oversold and be right to.
- **The model gets no tools.** Retrieval finishes before it is called. It cannot query, fetch or
  execute anything, which is why a prompt injection cannot reach another user's data.
- **Model output is untrusted input.** Zod-validate it, repair once, then reject. Render it only as
  React text nodes — no markdown parser, no sanitiser, no `dangerouslySetInnerHTML` in `features/ai`.
- **The user's words are never part of the system prompt.** `AIMessage` has no `system` role.
- **Intent detection is a rule, not a model call.** Routing decides what to retrieve, and retrieval
  must be deterministic. Only what the intent needs is retrieved — an RSI question loads no portfolio.
- **Every prompt lives in `features/ai/prompts.ts`.** Never assemble one in a route handler.
- **Natural language becomes a proposal, never an execution.** The screener translator returns
  `{ metric, operator, value }` through the same closed enums a hand-built screen uses; the user
  reviews them and the existing `/api/screener` runs them. AI never creates an alert.
- **The daily limit is counted in `ai_usage`, not in memory**, and fails closed. The in-memory
  limiter is a per-minute brake, nothing more.
- **`AI_ENABLED=false` must leave every other feature working**, and both configurations must build.
- Log what happened, never what was said: no prompt, no answer, no key, no portfolio figure.

## Alert Rules

Full detail in [`docs/ALERTS.md`](docs/ALERTS.md).

- **Rule, event and notification are three tables and three concepts.** Never collapse them.
- **An alert fires on a crossing, never on a comparison.** `current > target` alone notifies on every
  poll. The `armed → triggered` transition in `domain/alerts.ts` is the only thing that produces an
  event; returning to `armed` requires the condition to go false.
- Daily change and total return are separate alert types. "Gain %" is ambiguous and is never used.
- Percentage change is measured against the **previous close**, fixed and documented.
- A missing reading is `null` — a symbol with no quote is not a symbol at zero, and a symbol that is
  not held has no weight rather than a weight of 0%.
- A quote older than 15 minutes never triggers anything. A provider outage triggers nothing at all.
- **One batched quote call per run, for the union of every alert's symbol.** Never a fetch per alert.
- Evaluation is server-side. A `setInterval` in a tab is not an alert system.
- The cron endpoint rejects every request when `CRON_SECRET` is unset. Never treat an unset secret as
  open access.
- The service-role key is used in exactly one place — the scheduled job — and nowhere reachable from
  a request.
- Alert conditions are enums. Never accept a client-supplied expression.
- **Push payloads never contain portfolio figures.** Prices are public and are named; value, return
  and weight say "open Stockly to see". A lock screen is not a private surface.
- Push 404/410 deletes the subscription. Any other failure is left alone. There is no retry queue.
- In-app is written first and always; push is best-effort on top.

## Market Data Rules

- Add a provider by writing an adapter next to `twelve-data-provider.ts`, declaring the markets it
  covers, and adding one `case` to `create()`. Nothing outside `services/market-data/` changes.
- Never call a provider from a client component or from a loop over holdings. Batch through
  `getQuotesFor(instruments)`, once, on the server: it groups by market and makes **one call per
  market**. `getMarketDataProvider(market).getQuotes(symbols, market)` is the single-market form.
- A provider is never asked for a market it does not declare. Answering a SET symbol from a US
  endpoint yields a plausible price in the wrong currency, which is worse than no price at all.
- Every method resolves or throws `MarketDataError`. A missing symbol is `null` or `[]`, not an error;
  a rate limit or an outage is an error. Route handlers turn those into the shared envelope with a
  `MARKET_DATA_*` code, and the raw provider text is logged, never returned.
- Market data must never take a page down: `loadPortfolioView` falls back to cost, flags the holdings
  `stale`, and the page says so.
- Do not infer market status from the browser clock. Ask the provider; `domain/calendar.ts` fills
  the gap in the market's own timezone and says "unknown" rather than guessing.
- Client polling is opt-in per component, only while the market is open, and never in a background tab.

## API Rules

- Route handlers: parse with Zod → resolve the authenticated user → query through Supabase (RLS
  applies) → return. Never accept a `user_id` from the request body.
- Response shape: `{ data: T }` on success, `{ error: { code, message, details? } }` on failure.
  Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 missing, 409 conflict, 500 else.
- Never leak Postgres or provider error text to the client; log it server-side, return a stable `code`.
- Rate-limit anything that hits a paid upstream (market data, search) or sends notifications.

## Database Rules

- Every schema change is a migration file in `supabase/migrations/` — no changes made only in the
  Supabase dashboard.
- Migrations are forward-only and never edited after being applied to a shared environment.
- Required on user data: `user_id` FK to `auth.users`, RLS enabled, explicit select/insert/update/delete
  policies. New table without RLS = incomplete.
- Foreign keys with deliberate `on delete` behaviour; indexes on every FK and on the columns actually
  filtered/sorted; `check` constraints for invariants (quantity > 0, price >= 0, enum-like text).
- Monetary/quantity columns use `numeric`, never `float8`.

## Security Rules

Never:
- expose an API key or service-role key to the client (only `NEXT_PUBLIC_*` is client-visible);
- hardcode a secret, or commit `.env*` (only `.env.example` is tracked);
- trust a client-supplied total, price, P&L, or `user_id`;
- write a query whose isolation depends solely on application code;
- store passwords or roll custom auth — Supabase Auth owns credentials.

Always: parse `process.env` once through `lib/env.ts` and fail fast at startup on anything missing.

## Testing Rules

- `domain/` calculations: unit tests are mandatory, including the awkward cases — partial sells, sells
  that empty a position, fees, re-buys after a full exit, zero-quantity, dividend on a closed position.
- Route handlers: integration tests covering validation failure, unauthenticated access, and
  cross-user access (user A must not read user B).
- E2E (Playwright): the money paths only — sign in, record a buy, record a sell, see the dashboard update.
- Do not test shadcn primitives or Next.js itself.

## PWA Rules

Full detail in [`docs/PWA.md`](docs/PWA.md).

- **Nothing authenticated is ever written to a cache.** The service worker does not intercept
  `/api/**`, `/auth/**`, non-GET requests, other origins, or any navigation response. Adding a cache
  rule that touches user data is the one change that needs a second opinion.
- Navigations are network-only with `/offline` as the fallback. Quotes and history are cached on the
  **server** by TTL, where the cache is not tied to a device that may have several users.
- Sign-out clears the query cache and every service-worker cache before ending the session.
- The worker is registered as `/sw.js?v=<APP_VERSION>` from `lib/version.ts` — bump that one constant
  to invalidate caches. Never hardcode a version inside `sw.js`.
- An update is offered, never forced: a reload mid-form loses the user's input.
- Manifest via `app/manifest.ts`. iOS ignores it, so `appleWebApp` metadata and `apple-touch-icon`
  carry the iOS install path; Safari has no install API, so iOS gets instructions, not a fake button.
- **Touch targets use `pointer-coarse:`, not a width breakpoint.** A 768px iPad is a touch device and
  a 640px desktop window is not. ≥44px whenever the pointer is coarse.
- Dialogs are bottom sheets on touch-sized screens, centred from `sm` up.
- Mobile-first: bottom tab bar (four items), tables become cards below `lg`, no horizontal page
  scroll at 390px. Light and dark mode are both first-class.
- Charts load through `next/dynamic` with `ssr: false`. The login page must never pull the chart
  library.
- Every PWA capability degrades: no service worker, blocked storage or no install event costs a
  feature and nothing else.

## Production Rules

Full detail in [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md),
[`docs/PRODUCTION-RUNBOOK.md`](docs/PRODUCTION-RUNBOOK.md),
[`docs/PRODUCTION-ARCHITECTURE.md`](docs/PRODUCTION-ARCHITECTURE.md) and
[`docs/DISASTER-RECOVERY.md`](docs/DISASTER-RECOVERY.md).

- **Isolation is the database's job, never a handler's.** A child row carries `user_id` *and* a
  composite foreign key to `(portfolio_id, user_id)`. If a rule can be a constraint, it is one.
- **Every route goes through `guarded()`.** It resolves the session, times the request, logs it, and
  maps everything thrown onto the shared envelope with a request id. No route handler catches its
  own errors into a bespoke response.
- **Never return a stack trace, a Postgres message or a provider's text.** Log it against the
  request id and return a stable code. The id is the only thing a user needs to quote.
- **Rate-limit anything that spends money**, and remember which limiter is which: the in-memory one
  is a brake on loops, the database-counted one is the ceiling. A spending cap fails closed.
- **Every external call has a timeout and a bounded retry.** Retry a rate limit, a timeout and a
  transient outage; never a bad key or an unusable response.
- **Third parties degrade, they do not cascade.** A market-data outage falls back to cost basis and
  says so; AI failing costs the assistant alone. Readiness probes Postgres and nothing else.
- **The CSP is nonce-based, so every route that renders a script must be server-rendered.** A
  statically prerendered page has no nonce, and its scripts are blocked in production only. Adding
  `export const dynamic = "force-dynamic"` is the fix; the smoke test asserts it.
- **Log what happened, never what was said.** No password, token, key, prompt, answer or portfolio
  figure. `lib/log.ts` redacts by field name and by value shape; the call sites are the real
  guarantee.
- **Migrations are forward-only and additive**, so code can always roll back without touching the
  schema. A destructive change needs a two-step deploy.
- **Every list endpoint is paginated**, and the calculation engine never reads a page — a portfolio
  derived from one page would be wrong.
- **Request bodies are capped** (64 KB) before `JSON.parse`, by declared length and by measured
  bytes. App Router handlers have no default limit.
- **Anything that can be turned off without a deploy, should be**: `AI_ENABLED`,
  `MARKET_DATA_PROVIDER=mock`, an unset `CRON_SECRET`, `CSP_MODE`.
- **A checklist item is ticked with the thing that makes it true, or left open with the reason.**
  Never tick a box because it sounds done.

## Git Convention

Conventional Commits: `<type>(<scope>): <description>` — `feat`, `fix`, `refactor`, `docs`, `test`,
`chore`, `style`, `perf`, `build`, `ci`. Scope is the feature or area (`portfolio`, `pwa`, `auth`, `db`).

**Claude must never run `git commit` or `git push` unless the user asks in that message.** Finish the
work, run the checks, summarize the diff, and propose a commit message for the user to run themselves.

Before proposing one: `git status`, `git diff`, scan the change set for secrets, then
`npm run verify`. A commit message proposed without those four is a guess.

## Development Workflow

Before starting any feature: read this file → check `docs/ARCHITECTURE.md` → look for an existing
component, hook, domain function or service to reuse → plan → implement → `npm run verify` → report
results and propose a commit message.

Anything that touches a route handler, a migration or the middleware is also a production change:
re-read the relevant section of `docs/PRODUCTION-CHECKLIST.md` and update it in the same edit if the
change makes one of its statements untrue.

Prefer the smallest change that fully works. No speculative abstractions, no scaffolding "for later".

## Development Phases

| Phase | Scope |
|---|---|
| 0 ✅ | Foundation: CLAUDE.md, architecture doc, folder structure, `.env.example` |
| 1 ✅ | MVP: auth, portfolios, transactions, derived holdings, dashboard, P&L |
| 2 ✅ | Market data: symbol search, quotes, historical prices, charts, watchlist |
| 3 ✅ | Analytics: allocation, performance, dividends, cash, realized/unrealized breakdown |
| 4 ✅ | PWA: service worker, offline shell, install flows, mobile/touch pass |
| 5 ✅ | Alerts: price, percentage, portfolio and position alerts; notification centre; Web Push |
| 6 ✅ | Technical analysis: indicators, technical score, screener, technical alerts |
| 7 ✅ | AI: provider abstraction, grounded research assistant, natural-language screener, usage and cost controls |
| 8 ✅ | Production hardening: security headers, ownership constraints, rate limits, observability, health probes, CI, E2E, legal pages, runbook |
| 9 ✅ | Multi-market foundation: market/instrument registry, portfolio base currency, FX abstraction and caching, provider routing, SET support, market calendars, cross-currency valuation |
| 10 | Advanced: historical FX and currency attribution, benchmark comparison, FIFO cost basis |

Do not start the next phase without being asked.

## Reference

UX/functionality inspiration only: https://saph-set.pages.dev/ — do not copy its source, assets,
branding, or reproduce its design pixel-for-pixel. Stockly's UI is our own.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
