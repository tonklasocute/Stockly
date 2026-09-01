# Stockly

Personal stock portfolio tracker — a Next.js web app that installs as a PWA. Record buy and sell
transactions; Stockly derives your holdings, average cost, and realized and unrealized profit and loss.

**Phases 1–7 are implemented:** authentication, portfolios, transaction CRUD, the holdings and P&L
engine, the dashboard; live market data — stock search, quotes, price charts, company profiles and a
watchlist; and analytics — allocation, concentration, contribution, trade and fee statistics,
dividend tracking, cash management and CSV export; an installable PWA with an offline app shell; server-side alerts with a notification centre and Web
Push; technical analysis — indicators, an explainable technical score, a stock screener and
technical alerts; and Stockly AI — a research assistant that answers questions about your stocks,
portfolio and watchlist in plain language, grounded in Stockly's own data, plus a natural-language
screener. AI ships switched off; everything else works without it.

Install it from Chrome (Install app) or iOS Safari (Share → Add to Home Screen). The service worker
only runs in a production build — use `npm run build && npm start` to try it locally.

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

### Market data

The app ships with `MARKET_DATA_PROVIDER=mock`, which serves fixed prices and needs no account — so
everything works out of the box. For live prices, get a free [Twelve Data](https://twelvedata.com)
key and set:

```bash
MARKET_DATA_PROVIDER=twelvedata
MARKET_DATA_API_KEY=your-key
```

The free tier allows 8 API credits per minute and 800 per day, and **a batch quote costs one credit
per symbol**. Responses are cached server-side (quotes 60s, history and profiles far longer), which
is what keeps a normal portfolio comfortably inside that budget. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full caching table.

### Stockly AI

Off by default. Everything else works exactly the same with it off, and the production build
succeeds either way.

```bash
AI_ENABLED=true
AI_PROVIDER=anthropic          # or openai (also covers local models via AI_BASE_URL), or mock
AI_API_KEY=your-key            # server-only; never prefix an AI variable with NEXT_PUBLIC_
AI_MODEL=claude-opus-5
```

`AI_PROVIDER=mock` needs no account: it returns a clearly-labelled placeholder narrative beside
entirely real data, which is how the feature and its tests run without spending anything.

The assistant explains and compares; it never gives investment advice, price targets or forecasts,
and every figure it shows comes from Stockly's own engines rather than from the model. See
[`docs/AI.md`](docs/AI.md), and [`docs/AI-SECURITY.md`](docs/AI-SECURITY.md) for the limits.

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

Alerts are evaluated on the server on a schedule, so they fire whether or not the app is open — see
[`docs/ALERTS.md`](docs/ALERTS.md) for the crossing logic, cooldown and security model. Set
`CRON_SECRET` before deploying: without it the scheduled endpoint rejects every request, including
Vercel's own.

Market data sits behind a `MarketDataProvider` interface, so swapping Twelve Data for Finnhub or
Polygon is one adapter file plus one line in `services/market-data/index.ts`.

Every financial formula is specified in
[`docs/PORTFOLIO-CALCULATIONS.md`](docs/PORTFOLIO-CALCULATIONS.md) — cost basis, the two dividend
yields, win rate, and why a deposit is not a return.

See [`CLAUDE.md`](CLAUDE.md) for the conventions and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for the reasoning behind them.
