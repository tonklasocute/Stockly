# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Stockly** — personal stock portfolio tracker, delivered as a Next.js web app that is also an
installable PWA (desktop, iOS, Android). Users record buy/sell transactions, and the app derives
holdings, cost basis, P&L, allocation, dividends and cash balance from them.

Markets: US stocks first, SET (Thailand) later. Multi-portfolio from day one, multi-currency later.

**Status: Phase 1 (MVP) complete.** Auth, portfolios, transaction CRUD, the holdings/P&L engine and
the dashboard are implemented. Prices come from a mock provider. See [Development Phases](#development-phases).

## Commands

```bash
npm run dev              # dev server
npm run build            # production build
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm test                 # vitest (unit)
npm test -- holdings     # a single test file / pattern
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
| Charts | Recharts (allocation, performance) / Lightweight Charts (price series) | see `docs/ARCHITECTURE.md` |
| Backend | Next.js Route Handlers | no separate service; see extraction path below |
| DB / Auth | Supabase (PostgreSQL + Auth + RLS) | RLS is the primary authorization boundary |
| Tests | Vitest (unit). Playwright when E2E is first needed | |
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
3. **Market data goes through one interface.** `services/market-data/` exposes a `MarketDataProvider`
   (`getQuote`, `getHistoricalPrices`, `searchSymbol`, `getCompanyProfile`). No provider name (Finnhub,
   Twelve Data, …) may appear outside that folder. Provider calls are **server-side only** — API keys
   never reach the client.
4. **Every user-owned table carries `user_id` and has RLS enabled**, default-deny. Do not rely on
   route handlers alone to scope queries.

### Folder structure

```
app/         routes + route handlers (app/api/**). Server Components by default.
components/  shared presentational UI. components/ui/ = shadcn primitives.
features/    feature slices (portfolio/, transactions/, watchlist/, …).
             Each owns its components/, hooks/, schema.ts, api.ts. Cross-feature
             imports go through the feature's index, or the code belongs in lib/.
domain/      pure business logic + calculations. No framework imports. Heavily tested.
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

- Manifest via `app/manifest.ts` (Next.js native). `display: standalone`, theme + background colours
  matching light/dark.
- Icons: 192 / 512 / 512-maskable, plus `apple-touch-icon` (iOS ignores the manifest icons).
- Service worker registered from a small client component; cache the app shell and static assets, and
  serve an offline fallback page. **Never cache quotes, holdings, or any authenticated API response.**
- Respect iOS: `viewport-fit=cover` and `env(safe-area-inset-*)` padding on fixed headers and the
  bottom navigation. Touch targets ≥ 44px.
- Mobile-first: bottom navigation on small screens, tables become cards, charts stay readable at 375px.
- Light and dark mode are both first-class.

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
| 2 | Market data: symbol search, quotes, historical prices, charts, watchlist |
| 3 | Analytics: allocation, performance, dividends, realized/unrealized breakdown |
| 4 | PWA: service worker, offline fallback (manifest, icons and metadata already shipped in phase 1) |
| 5 | Alerts: price / target buy / stop loss / take profit, notifications |
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
