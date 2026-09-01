# Stockly

Personal stock portfolio tracker — a Next.js web app that installs as a PWA. Record buy and sell
transactions; Stockly derives your holdings, average cost, and realized and unrealized profit and loss.

**Phase 1 (MVP) is implemented:** authentication, portfolios, transaction CRUD, the holdings and
P&L engine, and the dashboard. Prices come from a mock provider — live market data is phase 2.

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in the two NEXT_PUBLIC_SUPABASE_* values
npm run dev
```

### Supabase

1. Create a project at [supabase.com](https://supabase.com) (or run `supabase start` locally).
2. Put the project URL and anon key in `.env.local`.
3. Apply the schema — paste `supabase/migrations/20260901000000_init.sql` into the SQL editor, or
   run `supabase db push` with the CLI. It creates the tables, indexes, constraints and RLS policies.
4. Register a user in the app, then optionally load demo data:
   ```bash
   psql "$DATABASE_URL" -v email=you@example.com -f supabase/seed.sql
   ```

Until `.env.local` is filled in, the app renders a setup notice instead of crashing.

## Commands

| | |
|---|---|
| `npm run dev` | dev server |
| `npm run build` | production build |
| `npm run lint` | eslint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | unit tests (vitest) |
| `npm test -- holdings` | a single test file |

## How it works

Transactions are the only source of truth. Holdings, average cost, realized and unrealized P&L are
recomputed from them on every request by the pure functions in [`domain/`](domain/), so editing or
deleting a transaction can never leave a stale position behind.

See [`CLAUDE.md`](CLAUDE.md) for the conventions and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the reasoning behind them.
