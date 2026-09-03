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

## News (phase 18)

| | Limit | |
|---|---|---|
| `GET /api/news?portfolioId&scope&sort&category&limit` | 30 | One endpoint, not three: portfolio, watchlist and market feeds are the same query with a different instrument set, and three routes would be three copies of the ranking. `scope`, `sort` and `category` are validated against closed enums. |

The response says **why** an article is in the feed — `HELD`, `WATCHED` or `MARKET` — and nothing
about the position behind it. Ranking uses the caller's holdings, computed on the server under their
own session; the holdings never leave it. A deployment with no news vendor returns `covered: false`
so the UI can say "not configured" rather than "no news", and a partial provider failure is reported
rather than passing a short feed off as a complete one.

## Fundamentals and events (phase 17)

Both are authenticated and rate-limited. The **data** is public reference information; the ability
to make Stockly *fetch* it is not, and an unauthenticated endpoint that spends provider credits is
one somebody will spend for us.

| | Limit | |
|---|---|---|
| `GET /api/fundamentals?symbol&market&price` | 30 | Statements, derived metrics, growth, valuation and events for one instrument. Accepts **no portfolio id** — it answers questions about a company and cannot be asked about a user. Price is passed in so the caller's existing quote is reused rather than paying for a second one. |
| `GET /api/events?portfolioId` | 20 | Upcoming events for the instruments the caller holds or watches, joined on the server under their own session. Carries a `relation` of HELD or WATCHED and **no quantity, value or cost** — enough to say why a row is there, nothing about the size behind it. |

Both degrade rather than fail: a provider outage yields empty sections with a reason, and a
deployment with no fundamentals vendor reports `covered: false` so the UI can say "not configured"
rather than "no data".

## History and attribution (phase 16)

**One endpoint, not six.** `/history`, `/attribution`, `/contributors`, `/drawdowns`,
`/monthly-performance` and `/allocation-history` would be six reads of the same two things — the
transaction set and the snapshot series — because every one of those answers is derived from them.

| | |
|---|---|
| `GET /api/history?portfolioId&period` | Valued series, flow-adjusted index, TWR and MWR, value change and capital flows (stated separately, never conflated), money-weighted attribution with its residual, ranked contributors and detractors, drawdown events with recovery, monthly rows, turnover, fee impact and coverage counts. `period` is validated against a closed enum. |

Everything it returns is **derived on read**. There is no stored return, contribution or drawdown,
so correcting a transaction corrects the history. It makes **no upstream call** — all of it is rows
already in the database — so opening the history page cannot cost a provider credit.

`GET|POST /api/cron/snapshots` · shared secret — the end-of-day job. Calendar-aware (the market's
own trading date, never the server clock), bounded, and idempotent by upsert on
`(portfolio_id, snapshot_date)`.

## Personalization (phase 15)

Every route here is user-scoped by RLS, accepts no `userId`, and cannot move a figure — a
preference decides what is displayed, never what is calculated.

| | |
|---|---|
| `GET /api/preferences` | Theme, density, default portfolio, chosen metrics, dashboard layout, dismissed insights, pins and recents. |
| `PATCH /api/preferences` | A **partial** update — the theme toggle and the dashboard editor each send one field, so neither can revert the other. The layout is reconciled against the widget registry *before* it is stored, so a later read never has to repair it. |
| `DELETE /api/preferences` | Resets the dashboard by storing `[]`, which *means* the default rather than copying it. |
| `POST /api/preferences` | Pins, recently-viewed and insight dismissal — three read-modify-writes of one column, folded into one route because the domain function is the whole of the logic. A pin past the limit is reported, never granted by evicting something the user chose. |
| `GET\|POST /api/tags` · `PATCH\|DELETE /api/tags/:id` | A user's own labels. Names are unique per user case-insensitively, so "Growth" and "growth" cannot split a group in two. Max 40. |
| `POST\|DELETE /api/tags/assign` | Applies a tag to `(portfolio, market, symbol)` — never to a holding id, because a holding is derived from transactions rather than stored. Applying twice is not an error. |
| `GET\|POST /api/views` · `PATCH\|DELETE /api/views/:id` | Saved views: filters, sort, columns, grouping — every field a closed enum, never an expression. Stores no figure. Max 30. |

A resource that is not the caller's returns **404, not 403**.

## Sharing (phase 13)

**There is no public JSON API**, and that is the design. A shared portfolio is a page; adding a
JSON endpoint for it would be a second projection to keep in step with the first and a second place
to leak from. The routes below are all authenticated and all belong to the owner.

| | Limit | |
|---|---|---|
| `GET /api/shares?portfolioId` | — | Config, links, snapshots, publication state and the owner's own audit trail. |
| `PUT /api/shares` | 20 | Saves the settings **and republishes in the same request** — leaving a stale document behind after an owner withdrew a section would harm exactly the person who just tried to stop it. A rebuild that fails deletes the published row rather than leaving the old one standing. |
| `PATCH /api/shares` | 20 | Applies a preset. Presets start from all-off and never enable realised P&L, cash or search indexing. |
| `POST /api/shares/publish` | 10 | Rebuilds the published document from today's figures. The one endpoint here that spends an upstream credit. |
| `GET|POST /api/shares/links` | 20 | **The raw token is in the create response and nowhere else** — the database holds only its SHA-256, and it cannot be shown again. Max 20 active links. |
| `DELETE /api/shares/links/:id` | — | Revokes immediately. A link that is not the caller's is a `404`, never a `403`. |
| `GET|POST /api/shares/snapshots` | 10 | Freezes the current projection at its own token address. A request can supply neither a payload nor a token. Max 50. |
| `DELETE /api/shares/snapshots/:id` | — | Deletes a page. No transaction, holding or P&L figure is touched. |

Public reads happen in the page, not through this API: `/p/<slug>` selects from `published_shares`
under anonymous RLS, and `/share/<token>` and `/snapshot/<token>` call `security definer` functions
that require the token. All three return the same nothing for every reason they can fail.

## Import and data quality (phase 12)

**Preview writes nothing.** No session row, no staging table, no stored file — a user who abandons an
import leaves nothing behind. The uploaded bytes are parsed inside the request that received them
and dropped.

| | Limit | |
|---|---|---|
| `POST /api/imports/preview` | 30 | Two content types. `multipart/form-data` with `file` + `portfolioId` for the first upload: the format is chosen from the file's **magic bytes**, never its extension or name. `application/json` with `{ portfolioId, grid, mapping, sheet? }` afterwards, so re-mapping a column costs no re-upload. Returns rows classified `CREATE` / `DUPLICATE` / `REJECT`, each rejection carrying a reason code. 2 MB, 5000 rows, 60 columns, 500 characters per cell. |
| `GET /api/imports?portfolioId&page` | — | Session history. Counters only — the file is not there to return. |
| `POST /api/imports` | 10 | `{ portfolioId, grid, mapping, allowPartial? }` → 201. **Re-validates and re-fingerprints every row server-side**; the posted preview is a claim about what the user saw, not an instruction. `allowPartial` defaults `false`, so a file with rejected rows refuses rather than importing half a statement. |
| `GET /api/imports/:id` | — | One session plus its problem rows. Only `DUPLICATE` and `REJECT` rows are stored, as normalized values. |
| `DELETE /api/imports/:id` | — | Deletes the **history row only**. The FK is `on delete set null`: the transactions stay and lose their provenance link. Reversing an import means deleting transactions, knowingly. |
| `GET /api/data-quality?portfolioId` | — | Freshness and completeness issues with a category and a severity. There is no `POST /scan`: the scan is a pure read over the already-cached analytics pass, so there is nothing to trigger. |

Importing the same file twice creates nothing the second time, and the guarantee is a partial unique
index on `(user_id, import_fingerprint)` rather than an application check. Concurrent applies cannot
both win: the loser's batch fails `23505` and is retried row by row so genuinely new rows still land.

### `GET|POST /api/cron/data` · shared secret

Market and FX refresh, `30 21 * * 1-5`. Reuses the alerts job's `CRON_SECRET` and its constant-time
check rather than introducing a second credential, and **rejects every request when the secret is
unset**. Bounded: closed markets are skipped, `unknown` ones are refreshed, one batched quote call
per market, one FX call per pair, `maxDuration = 60`. Safe to run twice — it refreshes caches and
appends a `job_executions` row containing counters, never figures.

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

## Reconciliation and operations (phase 19)

**Nothing here changes a financial figure except the two endpoints that say so.** A reconciliation
compares two readings and records what it found; a difference becomes a change when the user
approves one, through the endpoints that have always created those rows.

| | Limit | |
|---|---|---|
| `GET /api/reconciliation?portfolioId` | — | Run history, newest first. |
| `POST /api/reconciliation` | 10/min | `{ portfolioId, sourceLabel, periodStart?, periodEnd?, positions[], balances[] }` → 201. Writes a run and its findings and **nothing else**. Reads the cached analytics pass, so it costs no extra quote call — which is also why it is rate-limited. Running it twice produces the same findings and changes nothing either time. |
| `GET /api/reconciliation/:id` | — | One run plus counts recomputed from its stored items, so a resolved finding shows immediately and the two can never disagree. |
| `DELETE /api/reconciliation/:id` | — | Deletes findings. It has never been able to delete money: no item references any financial table. |
| `GET /api/reconciliation/:id/items?page` | — | Paginated findings — a statement of 500 positions is 500 rows. |
| `PATCH /api/reconciliation/:id/items` | — | `{ itemId, resolution: ADJUSTED \| IGNORED \| EXPLAINED }`. **Records a decision; does not act on one** — marking an item `ADJUSTED` creates no adjustment. Scoped to the run in the path as well as to the item. |

A position or balance the statement omits is reported as `null`, never `0`. Cash is compared one
currency at a time with nothing converted, so there is no combined difference figure to read.

| | |
|---|---|
| `GET /api/adjustments?portfolioId` | Recorded splits. |
| `POST /api/adjustments` | `{ portfolioId, symbol, market, effectiveDate, numerator, denominator }` → 201. **Changes a derived figure without touching a transaction**: the row is applied in front of the replay engine. `event_type` is derived from the ratio rather than accepted from the client. A second identical split is `409` — applying one twice would square the ratio. |
| `DELETE /api/adjustments/:id` | Fully reversible. The transactions were never rewritten, so every figure returns to exactly what it was. |
| `POST /api/transactions/:id/correction` | `{ …transaction fields, reason }`. Both this and the plain `PATCH` are audited by a trigger; only this one carries *why*, because PostgREST sends each request as its own transaction and a reason set separately would never reach the trigger. Re-checks sell coverage first, exactly as an edit does. |
| `POST /api/transfers` | `{ fromPortfolioId, toPortfolioId, symbol?, market?, reason, apply }`. One computation, one flag: `apply: false` previews and **writes nothing at all**. The apply re-parents the transactions — no sale, no repurchase, and therefore no realized profit or loss. An instrument moves with its whole history or not at all. |
| `GET /api/audit?entityId` or `?portfolioId&page` | The before-and-after of every change to a money-bearing row. **Read-only, permanently**: `financial_audit` has a select policy and no insert, update or delete policy, so there is no write counterpart and never will be. |

`correct_transaction` and `transfer_instrument` are `security definer`, so RLS does not apply inside
them and their `auth.uid()` predicates are the ownership boundary. Neither is executable by the
anonymous role.

---

## Not in the API

No `user_id` parameter anywhere. No admin endpoints. No endpoint that accepts a price, a total or a
P&L — every figure is recomputed server-side. No endpoint the model can call: the AI orchestrator
finishes retrieval before the model is invoked, and the model is given no tools. No endpoint that
applies a reconciliation finding, and no scheduled job that applies an adjustment, resolves a
difference or corrects a transaction — every one of those is a decision a person makes.
