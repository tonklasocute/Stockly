# Production architecture

What runs in production, what it depends on, how each part fails, and what to do when it grows.
[ARCHITECTURE.md](ARCHITECTURE.md) explains *why* the structure is what it is; this file is the
operational view of the same system.

---

## 1. The deployment

```
                    ┌─────────────────────────────────────────────┐
   Browser / PWA ──►│ Vercel edge — middleware                    │
                    │  request id · CSP nonce · security headers  │
                    │  session refresh · auth redirect            │
                    └───────────────┬─────────────────────────────┘
                                    │
                    ┌───────────────▼─────────────────────────────┐
                    │ Vercel Node functions (region: default)     │
                    │  Server Components  ·  Route Handlers       │
                    └───┬───────────────┬──────────────┬──────────┘
                        │               │              │
              ┌─────────▼──────┐ ┌──────▼───────┐ ┌────▼──────────┐
              │ Supabase       │ │ Twelve Data  │ │ AI provider   │
              │ Postgres + RLS │ │ (or mock)    │ │ (optional)    │
              │ Auth           │ └──────────────┘ └───────────────┘
              └────────────────┘
                        ▲
              ┌─────────┴──────────┐
              │ Vercel Cron        │  every 5 min → /api/cron/alerts
              │ (secret-guarded)   │  snapshots · alerts · retention
              └────────────────────┘
```

One deployable. No queue, no Redis, no separate API service. Every one of those can be added behind
an existing boundary; none is needed at personal-portfolio scale, and each would be another thing
that can be down at 3am.

---

## 2. Components

| Component | Purpose | Depends on | Failure mode | Scaling strategy |
|---|---|---|---|---|
| **Middleware** (edge) | request id, CSP nonce, security headers, session refresh, auth redirect | Supabase Auth | Auth unreachable → `getUser()` returns null → every page redirects to `/login`. The site is up but nobody can sign in. | Runs at the edge and scales with Vercel. Keep it thin — it is on every request. |
| **Server Components** | dashboard, portfolio, analytics, stock, screener, AI pages | Supabase, market data | A quote failure falls back to cost basis and shows a banner. A Supabase failure renders the error boundary. | Per-request rendering; no shared state to contend on. |
| **Route Handlers** (`/api/**`) | all mutations and client-side reads | Supabase, market data, AI | Every path resolves to the shared envelope with a stable code and a request id. | Stateless; scales horizontally. |
| **`domain/`** | cost basis, P&L, indicators, screener, alerts, AI rules | nothing | Pure functions. Cannot fail on I/O; can only be wrong, which is what the 516 unit tests are for. | Pure CPU. A portfolio is hundreds of rows. |
| **Supabase Postgres** | every user record | — | **The one hard dependency.** Down means the app is down. | Managed. Connection exhaustion is not a risk — see §4. |
| **Supabase Auth** | credentials, sessions | — | Down means no new sign-ins; existing sessions fail to refresh and degrade to signed-out. | Managed. |
| **Market data** (`services/market-data`) | quotes, history, search, profiles | Twelve Data | `MarketDataError` with a code. Portfolio pages fall back to average cost, flag holdings `stale`, and say so. **Never takes a page down.** | Next Data Cache by TTL, shared across instances. Batch quotes. Swap providers by adding one adapter and one `case`. |
| **Technical engine** | indicators, score, snapshots | market data (via the job) | A snapshot older than 90 minutes is labelled delayed rather than presented as current. | Snapshots are shared reference data — computed once for everyone. A screen costs zero upstream requests. |
| **Screener** | structured filters over snapshots | `technical_snapshots` | An empty snapshot table means "no matches" and a message explaining the job has not run. | 10,000 snapshots filter in well under a second. Universe capped at 60 symbols by the provider's rate limit, not by design. |
| **Alert engine** | crossing detection, events, notifications | cron secret, service role, market data | Cron not firing means no alerts; the UI still shows the rules. A provider outage triggers nothing at all, by design. | One batched quote per run for the union of every symbol. Idempotency key makes a duplicate run a no-op. |
| **Notifications** | in-app rows, Web Push | `web-push`, VAPID | In-app is written first and always; push is best-effort on top. A 404/410 deletes the subscription. | No retry queue — deliberately. |
| **AI** (`services/ai`) | grounded research assistant | AI provider | `AIError` with a stable code. Feature flag off ⇒ no work at all. Everything else is unaffected. | Per-minute limiter plus a database-counted daily quota. |
| **Service worker** | offline shell, push display | — | Absent worker costs offline navigation and nothing else. | Caches only `/offline` and immutable build output — never anything authenticated. |
| **Cron** (`/api/cron/alerts`) | snapshots, alert evaluation, retention sweep | `CRON_SECRET`, service role | Rejects every request when the secret is unset. A failed run is retried by the next one five minutes later. | Budgeted: 12 snapshot refreshes per run, oldest first. |

---

## 3. Environments

| | Development | Preview | Production |
|---|---|---|---|
| Trigger | `npm run dev` | every pull request | `main` |
| Database | a local `supabase start`, or a **separate** Supabase project | a separate Supabase project | the production project |
| Market data | `mock` | `mock` or a throwaway key | the real key |
| AI | `mock` or off | `mock` | off until the budget is set, then a real key |
| `CRON_SECRET` | unset — the endpoint refuses everything | unset | set |
| Cron schedule | none | none | every 5 minutes |
| `CSP_MODE` | `enforce` (localhost is exempt from HSTS and upgrade-insecure-requests) | `enforce` | `enforce` |

**A development or preview deployment must never point at the production database.** There is no
technical guard against it — the connection string is an environment variable — so it is a rule
enforced by whoever sets the variables. The E2E specs create and delete portfolios, which is the
concrete reason it matters.

---

## 4. Serverless compatibility

The application is stateless. Three consequences worth stating, because they are the ones that
usually bite:

**No connection pool to exhaust.** Supabase is reached over HTTP (PostgREST), not a Postgres wire
connection. A cold start opens no socket, a frozen function leaks none, and the pooler settings that
dominate serverless Postgres deployments do not apply here. This is a real advantage of the client
choice and worth remembering before anyone reaches for `pg`.

**Two pieces of in-memory state, both deliberately advisory:**

- `lib/rate-limit.ts` — a fixed-window counter per instance. The real ceiling is `limit × instances`
  and a cold start forgets everything. It is a brake on accidental loops, not a security control.
  The controls that *do* hold are elsewhere: the cron secret, the per-user alert cap enforced by the
  database, the AI daily quota counted in `ai_usage`, and RLS.
- `/api/ready` caches its probe result for ten seconds so an unauthenticated prober cannot make the
  database do work.

**No local file persistence, no long-lived process, no socket.** Nothing is written to disk at
runtime. The scheduled work is an HTTP endpoint a scheduler calls, not a daemon.

---

## 5. Caching

| Layer | What | TTL | Where |
|---|---|---|---|
| Next Data Cache | quote | 60s | server, shared across instances |
| Next Data Cache | intraday history (1D/1W) | 5 min | server |
| Next Data Cache | daily history (1M+) | 6 h | server |
| Next Data Cache | symbol search | 24 h | server |
| Next Data Cache | company profile | 24 h | server |
| Postgres | technical indicators | refreshed by the job; **labelled delayed past 90 min** | `technical_snapshots` |
| Postgres | daily portfolio value | one row per portfolio per day | `portfolio_snapshots` |
| TanStack Query | anything the client re-fetches | 30s default | browser memory only |
| Service worker | `/offline` + immutable `_next/static` | until the version changes | device |

Two rules that are not negotiable:

- **Nothing authenticated is cached on a device.** The service worker skips `/api/**`, `/auth/**`,
  every non-GET, every other origin and every navigation response. A cached portfolio on a shared
  device replayed to the next user is the worst bug this application could have.
- **No market data is cached without an expiry.** Every entry above has a TTL, and anything past its
  freshness window is labelled rather than silently served as current.

Invalidation lives in `lib/cache.ts`. There is no stored aggregate to update — pages recompute from
Postgres — so invalidation means re-rendering routes, and `invalidatePortfolio()` does all of them
together because they derive from the same rows.

---

## 6. Trust boundaries

```
untrusted ─────────────────────────────────────────────────────► trusted
  request body        model output        provider payload        domain/
  query params        comment text        cron header             database
       │                    │                    │
    Zod at the          Zod + safety        Zod at the
    boundary            vocabulary          adapter
```

Four things are never trusted, whatever they claim to be:

1. **The client.** No `user_id` from a body, no price, no total, no P&L. Sells are re-checked
   against stored rows before they are accepted.
2. **The model.** Its output is parsed by Zod, checked against a forbidden-language list, and
   rendered only as React text nodes.
3. **The provider.** Every payload is Zod-parsed into the domain model at the adapter; no provider
   shape escapes `services/market-data`.
4. **The caller of the cron endpoint,** until it presents the secret, compared in constant time.

---

## 7. Where the next bottleneck is

In order of when it will actually be hit:

1. **The market-data free tier.** 8 credits a minute, one per symbol. It already caps the screener
   universe at 60 symbols and it will be the first thing that hurts. Fix: a paid tier, or a provider
   with a bulk endpoint — one adapter file.
2. **Company profiles.** The only unbatched fan-out left, one request per *held* symbol on the
   analytics page. Cached 24h and individually fault-tolerant. Fix: a provider with a batch profile
   endpoint, or a shared `instruments` table.
3. **The login bundle.** 1.3 MB uncompressed, of which ~250 KB is the Supabase browser client — see
   [PERFORMANCE.md](PERFORMANCE.md).
4. **The cron budget.** 12 snapshots per five-minute run refreshes 60 symbols in about 25 minutes.
   A larger universe needs a bulk provider, not a faster loop.
5. **Portfolio replay.** A portfolio is replayed from every transaction on every request. Free until
   tens of thousands of rows; the fix is caching computed positions per portfolio, invalidated on
   write.

None is urgent. Each has an insertion point that exists today.
