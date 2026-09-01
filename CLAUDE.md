# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Stockly** — personal stock portfolio tracker, delivered as a Next.js web app that is also an
installable PWA (desktop, iOS, Android). Users record buy/sell transactions, and the app derives
holdings, cost basis, P&L, allocation, dividends and cash balance from them.

Markets: US stocks first, SET (Thailand) later. Multi-portfolio from day one, multi-currency later.

**Status: Phase 5 complete.** On top of phases 1–4: a server-side alert engine with crossing logic
and cooldown, a notification centre, Web Push, and scheduled evaluation behind a cron secret. See
[Development Phases](#development-phases).

## Commands

```bash
npm run dev              # dev server
npm run build            # production build
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm test                 # vitest (unit)
npm test -- holdings     # a single test file / pattern
npm start                # serve the production build (PWA needs a real build, not `next dev`)
npx supabase gen types typescript --local > types/database.ts   # once a project exists
```

Keep this section accurate — update it in the same change that adds or renames a script.

No E2E runner is installed yet; add Playwright in the phase that writes the first spec, not before.

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
| Market data | Twelve Data, behind `MarketDataProvider` | free tier: 8 credits/min, 800/day, **1 credit per symbol** |
| Tests | Vitest (unit). Playwright when E2E is first needed | |
| Export | Hand-written CSV writer (`lib/csv.ts`) | 20 lines, with formula-injection escaping |
| Push | `web-push` (VAPID) | RFC 8291 encryption is not something to hand-roll |
| Scheduling | Vercel Cron → `/api/cron/alerts` | secret-guarded; any external scheduler works too |
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
             money.ts (precision) · holdings.ts (cost basis, P&L) · cash.ts · dividends.ts ·
             analytics.ts (allocation, concentration, contribution, trade + fee statistics)
lib/         cross-cutting infra: supabase clients, env parsing, formatting, constants.
services/    external integrations behind interfaces (market-data/).
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

- Add a provider by writing an adapter next to `twelve-data-provider.ts` and adding one `case` to
  `getMarketDataProvider()`. Nothing outside `services/market-data/` changes.
- Never call a provider from a client component or from a loop over holdings. Batch through
  `getQuotes`, once, on the server.
- Every method resolves or throws `MarketDataError`. A missing symbol is `null` or `[]`, not an error;
  a rate limit or an outage is an error. Route handlers turn those into the shared envelope with a
  `MARKET_DATA_*` code, and the raw provider text is logged, never returned.
- Market data must never take a page down: `loadPortfolioView` falls back to cost, flags the holdings
  `stale`, and the page says so.
- Do not infer market status from the browser clock. Ask the provider, or show "unavailable".
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

## Git Convention

Conventional Commits: `<type>(<scope>): <description>` — `feat`, `fix`, `refactor`, `docs`, `test`,
`chore`, `style`, `perf`, `build`, `ci`. Scope is the feature or area (`portfolio`, `pwa`, `auth`, `db`).

**Claude must never run `git commit` or `git push` unless the user asks in that message.** Finish the
work, run the checks, summarize the diff, and propose a commit message for the user to run themselves.

## Development Workflow

Before starting any feature: read this file → check `docs/ARCHITECTURE.md` → look for an existing
component, hook, domain function or service to reuse → plan → implement → `npm run lint` →
`npm run typecheck` → run the affected tests → report results and propose a commit message.

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
| 6 | Advanced: technical indicators, screener, AI analysis, multi-market, multi-currency |

Do not start the next phase without being asked.

## Reference

UX/functionality inspiration only: https://saph-set.pages.dev/ — do not copy its source, assets,
branding, or reproduce its design pixel-for-pixel. Stockly's UI is our own.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
