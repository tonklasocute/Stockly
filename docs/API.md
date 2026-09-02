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
| `POST /api/portfolios` | `{ name, currency }` → 201. `409` on a duplicate name. `currency` is the portfolio's **base currency**: what every total on its pages is denominated in. |
| `PATCH /api/portfolios/:id` | `{ name, currency }`. |
| `DELETE /api/portfolios/:id` | Cascades to transactions, dividends, cash and snapshots. |

## Transactions

| | |
|---|---|
| `GET /api/transactions?portfolioId&page` | One page. The calculation engine does **not** use this — holdings are derived from every row. |
| `POST /api/transactions` | `{ portfolioId, symbol, market?, side, tradeDate, quantity, price, fee, notes? }` → 201. `market` is `"US" \| "SET"`, defaulting to `"US"`, and fixes the currency of `price` and `fee`. A sell is re-checked server-side against stored rows **for that market**; overselling is a `VALIDATION_ERROR` naming the quantity actually held. |
| `PATCH /api/transactions/:id` | Same body. An edit that would oversell is rejected, with the row's own previous version excluded from the check. |
| `DELETE /api/transactions/:id` | |

## Dividends and cash

`GET|POST /api/dividends`, `PATCH|DELETE /api/dividends/:id` —
`{ portfolioId, symbol, market?, currency?, paymentDate, shares, dividendPerShare, tax, fee, notes? }`.
`currency` defaults to the market's; it is stored rather than derived because a listing can pay in a
currency other than the one it trades in.

`GET|POST /api/cash`, `PATCH|DELETE /api/cash/:id` —
`{ portfolioId, kind: "deposit"|"withdrawal", amount, currency?, occurredOn, notes? }`. `amount` is
always positive; the direction lives in `kind`. `currency` defaults to the portfolio's base currency
and is genuinely stored — one portfolio can hold balances in more than one currency at once.

`market` and `currency` are **closed enums** on every endpoint that accepts them
(`domain/market.ts`), never free text. A market the app cannot price would be routed to the wrong
provider and valued in the wrong currency — a silently-wrong number rather than a visible error — so
it is rejected at the boundary and again by a `check` constraint in the database.

## Analytics

`GET /api/analytics/export?portfolioId&dataset=transactions|dividends|cash|summary` — CSV, written by
`lib/csv.ts` with formula-injection escaping. Transaction and dividend rows carry `Market` and
`Currency` columns, and the summary's first row names the base currency every figure below it is in:
a spreadsheet of prices with no currency beside them is the fastest way to add baht to dollars by
accident.

## Watchlist

`GET|POST /api/watchlist` · `DELETE /api/watchlist/:symbol?market=`. Uniqueness is per
`(user, market, symbol)`, so the same ticker on two venues is two rows; a duplicate is a `409`
translated from the unique constraint, not an application check.

## Market data

All four hit a paid upstream and are rate-limited per user per minute.

| | Limit | |
|---|---|---|
| `GET /api/stocks/search?q=&market=` | 30 | Min 2 characters. Cached 24 h upstream. Without `market`, every market Stockly supports; each result is tagged with its own venue and currency. |
| `GET /api/stocks/:symbol/quote?market=` | 60 | Cached 60 s. `404` for an unknown symbol; a rate limit or outage is a `MARKET_DATA_*` error, never a 404. |
| `GET /api/stocks/:symbol/history?range=1D…MAX&market=` | 30 | Cached 5 min to 6 h by range. |
| `GET /api/stocks/:symbol/technical?market=` | 20 | Cache first; computes on demand on a miss, which costs a full OHLCV request. Returns `{ snapshot, calculatedAt, stale, source, market, currency }` — indicators are computed from the instrument's **native** price series, so `currency` is the market's, never the portfolio's. |

## Screener

| | Limit | |
|---|---|---|
| `GET /api/screener` | — | The presets, so the client renders exactly what the server would run. |
| `POST /api/screener` | 30 | `{ definition: { logic, filters[], sort? }, market?, page }`. **Zero upstream requests**: runs against cached snapshots. `metric` and `operator` are closed enums; `value` is a number or a trend name. Max 10 filters. `market` narrows the **universe** before any threshold is applied and changes no reading on any instrument — a screener is currency-independent, and each row reports the currency its price column is in. |
| `GET|POST /api/screener/saved` · `DELETE /api/screener/saved/:id` | 20 | Max 30 saved screens per user. |

## Investment intelligence (phase 10)

Every one of these is scoped by RLS plus a composite foreign key to `(portfolio_id, user_id)`: an id
from another user matches zero rows and returns `404`, which is also the right answer — a caller has
no way to tell a row they cannot see from one that does not exist. **None of these endpoints returns
a derived financial figure**; progress, returns and P&L are computed on the pages that render them,
so there is no stored number here to go stale.

| | |
|---|---|
| `GET /api/journal?portfolioId&type&symbol&market&from&to&q&page` | One page of the timeline, newest first. Filters are applied in Postgres; `q` is escaped before it reaches PostgREST's filter syntax. |
| `POST /api/journal` | `{ portfolioId, type, symbol?, market?, transactionId?, reason?, title, content, entryDate }` → 201. `reason` is legal only on a `SELL_REASON` entry; a transaction-scoped entry needs a symbol. `409` on a second sell review for the same trade. |
| `PATCH` and `DELETE /api/journal/:id` | An edit cannot move an entry to another portfolio or re-point it at another trade. |
| `GET` and `POST /api/theses` | `{ portfolioId, symbol, market?, title, whyBought, expectations, catalysts, risks, invalidationCriteria, conviction, status }`. Conviction 1–10. `409` when an open thesis already covers that instrument. **`status` is whatever the user sent — nothing derives it.** |
| `PATCH` and `DELETE /api/theses/:id` | An edit cannot change the instrument. |
| `GET` and `POST /api/goals` | `{ portfolioId, type, targetValue, currency?, targetDate?, note? }`. A `TOTAL_RETURN` target is a percentage and must have **no** currency; every other type must have one. `409` on a duplicate type. |
| `PATCH` and `DELETE /api/goals/:id` | **No `type` field**: changing it would silently reinterpret the target. |
| `GET /api/benchmarks` | The benchmarks this deployment knows, each with `available` — whether the provider's plan can actually serve its series. |
| `PUT /api/benchmarks` | `{ portfolioId, benchmarkId }`. `null` clears the selection. One benchmark per portfolio, upserted. |

## Simulations (phase 11)

**There is no endpoint that runs a simulation**, and that is the design rather than an omission:
every calculation in `domain/simulation` is pure, so it runs in the browser as an input changes. A
round trip per keystroke would add latency to arithmetic and a second place for the formula to live.

| | |
|---|---|
| `GET /api/simulations?portfolioId` | Saved scenarios: the portfolio's, plus the standalone ones that belong to no portfolio. |
| `POST /api/simulations` | `{ portfolioId \| null, name, type, inputs }` → 201. `inputs` is validated against the schema for `type`, so a DCA scenario cannot carry what-if adjustments. `409` on a duplicate name or once 50 scenarios exist. |
| `PATCH` and `DELETE /api/simulations/:id` | Rename, or replace the inputs. **No `type` field** — the shape of `inputs` depends on it. |

**A saved scenario stores inputs, never results.** Everything it produces is recomputed on open by
the same pure functions that produced it the first time, so it cannot go stale and is never
financial history.

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
