# API reference

Every HTTP endpoint Stockly exposes. All of them are Next.js Route Handlers in `app/api/**`.

---

## Conventions

**Authentication.** Every endpoint except `/api/health`, `/api/ready` and `/api/cron/alerts`
requires a Supabase session cookie. There is no API key, no bearer token and no public API surface.

An unauthenticated API call returns a JSON `401`, never a redirect to the login page — a `fetch`
client following a 307 receives HTML and reports something useless.

**Authorization** is row-level security in Postgres, not application code. A request for another
user's row matches nothing and returns `404`, deliberately rather than `403`: a 403 confirms the id
exists. No endpoint accepts a `user_id`; it always comes from the session.

**Envelope.**

```jsonc
// success
{ "success": true, "data": { /* … */ } }

// failure
{ "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "Invalid request data.",
             "details": { "quantity": ["Enter a number."] } },
  "requestId": "iad1::abc-123" }
```

`requestId` is echoed in the `X-Request-Id` header on every response and appears on every log line
for that request. It is what a user quotes in a bug report.

**Codes.**

| Code | Status | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | The body or a query parameter failed its Zod schema. |
| `UNAUTHENTICATED` | 401 | No session. |
| `FORBIDDEN` | 403 | Reserved; RLS returns 404 instead. |
| `NOT_FOUND` | 404 | No such row — or it belongs to someone else. |
| `CONFLICT` | 409 | A unique constraint or a per-user cap. |
| `PAYLOAD_TOO_LARGE` | 413 | Body over 64 KB. |
| `RATE_LIMITED` | 429 | Per-minute limiter. |
| `INTERNAL_ERROR` | 500 | Anything else. The detail is in the logs, never in the response. |
| `MARKET_DATA_*` | 502/503/504/429 | Provider unavailable, invalid, timed out or rate-limited. |
| `AI_DISABLED` | 503 | `AI_ENABLED=false`. |
| `AI_NOT_CONFIGURED` | 500 | Enabled but no key or model. |
| `AI_UNAVAILABLE` / `AI_TIMEOUT` / `AI_RATE_LIMITED` | 503 / 504 / 429 | Provider failure. |
| `AI_INVALID_RESPONSE` | 502 | The model returned unusable JSON twice. |
| `AI_QUOTA_EXCEEDED` | 429 | The user's daily AI allowance is spent. |

**Limits.** Request bodies are capped at 64 KB. Rate limits are per user per minute and are listed
per endpoint below; they are an in-memory brake, while the AI daily quota is counted in the database
and is a real ceiling.

**Pagination.** List endpoints return `{ rows, page, pageSize, total, pageCount }` and take `?page=`.

---

## Operations

### `GET /api/health` · no auth
Liveness. Touches nothing.
```json
{ "status": "ok", "version": "0.5.0", "timestamp": "2026-09-02T…" }
```

### `GET /api/ready` · no auth
Readiness. One cached (10 s) round trip to Postgres. `200` when ready, `503` when not. Does **not**
probe the market-data provider or the model — Stockly is designed to work without either.
```json
{ "status": "ready", "version": "0.5.0",
  "checks": { "database": { "ok": true, "latencyMs": 41 } } }
```

### `GET|POST /api/cron/alerts` · shared secret
Refreshes technical snapshots, evaluates alerts, sweeps expired AI data. Authenticated by
`Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`, compared in constant time. **Rejects every
request when `CRON_SECRET` is unset.** Runs under the service-role key — the only place RLS is
bypassed.

---

## Portfolios

| | |
|---|---|
| `GET /api/portfolios` | The caller's portfolios. |
| `POST /api/portfolios` | `{ name, currency }` → 201. `409` on a duplicate name. |
| `PATCH /api/portfolios/:id` | `{ name, currency }`. |
| `DELETE /api/portfolios/:id` | Cascades to transactions, dividends, cash and snapshots. |

## Transactions

| | |
|---|---|
| `GET /api/transactions?portfolioId&page` | One page. The calculation engine does **not** use this — holdings are derived from every row. |
| `POST /api/transactions` | `{ portfolioId, symbol, side, tradeDate, quantity, price, fee, notes? }` → 201. A sell is re-checked server-side against stored rows; overselling is a `VALIDATION_ERROR` naming the quantity actually held. |
| `PATCH /api/transactions/:id` | Same body. An edit that would oversell is rejected, with the row's own previous version excluded from the check. |
| `DELETE /api/transactions/:id` | |

## Dividends and cash

`GET|POST /api/dividends`, `PATCH|DELETE /api/dividends/:id` —
`{ portfolioId, symbol, paymentDate, shares, dividendPerShare, tax, fee, currency, notes? }`.

`GET|POST /api/cash`, `PATCH|DELETE /api/cash/:id` —
`{ portfolioId, kind: "deposit"|"withdrawal", amount, currency, occurredOn, notes? }`. `amount` is
always positive; the direction lives in `kind`.

## Analytics

`GET /api/analytics/export?portfolioId&type=transactions|dividends|cash` — CSV, written by
`lib/csv.ts` with formula-injection escaping.

## Watchlist

`GET|POST /api/watchlist` · `DELETE /api/watchlist/:symbol`. A duplicate is a `409` translated from
the unique constraint, not an application check.

## Market data

All four hit a paid upstream and are rate-limited per user per minute.

| | Limit | |
|---|---|---|
| `GET /api/stocks/search?q=` | 30 | Min 2 characters. Cached 24 h upstream. |
| `GET /api/stocks/:symbol/quote?market=` | 60 | Cached 60 s. `404` for an unknown symbol; a rate limit or outage is a `MARKET_DATA_*` error, never a 404. |
| `GET /api/stocks/:symbol/history?range=1D…MAX` | 30 | Cached 5 min to 6 h by range. |
| `GET /api/stocks/:symbol/technical` | 20 | Cache first; computes on demand on a miss, which costs a full OHLCV request. Returns `{ snapshot, calculatedAt, stale, source }`. |

## Screener

| | Limit | |
|---|---|---|
| `GET /api/screener` | — | The presets, so the client renders exactly what the server would run. |
| `POST /api/screener` | 30 | `{ definition: { logic, filters[], sort? }, page }`. **Zero upstream requests**: runs against cached snapshots. `metric` and `operator` are closed enums; `value` is a number or a trend name. Max 10 filters. |
| `GET|POST /api/screener/saved` · `DELETE /api/screener/saved/:id` | 20 | Max 30 saved screens per user. |

## Alerts and notifications

| | Limit | |
|---|---|---|
| `GET|POST /api/alerts` | 20 | Type is an enum, never a client expression. Max 100 alerts per user, enforced against the database. |
| `PATCH|DELETE /api/alerts/:id` | — | Changing `targetValue` resets the crossing state to `armed`, or the old "triggered" would suppress the first real crossing. |
| `GET /api/notifications?page` · `PATCH /api/notifications/:id` · `POST /api/notifications/read-all` | — | |
| `GET|PUT /api/notifications/preferences` | — | Per-category plus push. |
| `POST /api/push/subscribe` · `POST /api/push/unsubscribe` | 10 | Standard `PushSubscription` JSON; endpoint must be HTTPS. |

## AI

All three require `AI_ENABLED=true`, are limited to 6/min per user, and consume the daily quota
counted in `ai_usage`. Node runtime, `maxDuration = 60`.

### `POST /api/ai/chat`
```jsonc
{ "question": "Analyse NVDA", "conversationId": "uuid?", "portfolioId": "uuid?" }
```
Returns `{ intent, symbols, narrative, grounded, completeness, dataAsOf, delayed, provider, model,
safetyFiltered, conversationId }`.

`narrative` is the only part the model wrote — five text fields, no numeric one. `grounded` carries
every figure, retrieved from Stockly's own engines. `portfolioId` is resolved against the caller's
own portfolios, never trusted as an id.

### `POST /api/ai/analyze`
`{ symbol }` or `{ symbols: [2–4] }`. Same response shape, with the intent forced. Symbols are still
validated against the supported universe; one that is not there comes back in
`grounded.unknownSymbols` rather than being described.

### `POST /api/ai/screener`
`{ query: "stocks with strong momentum" }` → `{ definition, explanation, provider, model }`.

**Proposes; never runs.** The definition goes through the same closed enums a hand-built screen
uses, the user reviews it, and `POST /api/screener` executes it.

### Conversations
`GET /api/ai/conversations` · `GET|DELETE /api/ai/conversations/:id`.

---

## Not in the API

No `user_id` parameter anywhere. No admin endpoints. No endpoint that accepts a price, a total or a
P&L — every figure is recomputed server-side. No endpoint the model can call: the AI orchestrator
finishes retrieval before the model is invoked, and the model is given no tools.
