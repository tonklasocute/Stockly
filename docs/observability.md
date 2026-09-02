# Observability

What Stockly emits, how to find one user's failure inside it, and what it deliberately does not
record.

## 1. The one thing to know

Every request carries a **request id**, and the user is shown it.

```
browser ──► middleware ──► route handler ──► provider call
             stamps id      logs api.request   logs market-data.fetch
             ▼                  ▼                    ▼
        X-Request-ID       requestId field      requestId field
```

`lib/log.ts:resolveRequestId` reuses an incoming `x-request-id` or Vercel's `x-vercel-id` when one
is present, so a trace is never broken in two, and generates a uuid otherwise. It is validated
against `^[A-Za-z0-9_:.-]{8,128}$` before use — an id ends up in a response header and a log line,
and neither is somewhere a client should be able to inject a newline.

A user reporting "it broke at 3pm" reads the id off the error card. Search for it and every line
from that request is together: the request, the error, and any provider call it made.

Background work is correlated the same way, by a different key:

| Flow | Correlation key | Where it appears |
|---|---|---|
| HTTP request | `requestId` | `api.request`, `api.error`, response header |
| Scheduled job | the `job` name plus a `job_executions` row | `cron.alerts`, `cron.data`, `refresh.completed` |
| Import | `sessionId` | `import.applied`, `import.rows_write_failed` |
| Share publish | portfolio-scoped `share_events` row | `share.published`, `share.publish_failed` |

## 2. Structured logging

One line, one JSON object, on `console` — which Vercel captures. A logging library would add a
dependency, a transport and a flush problem in a function that can be frozen mid-write, and buy
nothing.

```json
{"timestamp":"2026-09-02T08:53:23.194Z","level":"error","service":"stockly",
 "event":"api.error","requestId":"a572bbd2-…","route":"/api/transactions",
 "name":"PostgrestError","code":"23505","message":"duplicate key value violates unique constraint"}
```

`event` is a stable dotted name so a dashboard can group on it; the human-readable part lives in the
fields, never in the name. Levels are `debug · info · warn · error`, with production defaulting to
`info` — a debug line per request costs money at scale and, worse, tempts whoever added it to
include the payload that made it interesting. `LOG_LEVEL` overrides it.

### Event names

| Event | Emitted by | Carries |
|---|---|---|
| `api.request` | every route | route, status, latencyMs |
| `api.error` | `guarded()` catch-all | name, code, message |
| `market-data.fetch` | provider fetch | path, status or code, attempt, willRetry, latencyMs |
| `market-data.error` | route mapping | provider error code |
| `ready.database` | readiness probe | Postgres error code |
| `cron.alerts` / `cron.data` | scheduled jobs | counters only |
| `refresh.completed` | market/FX refresh | markets, symbols, FX pairs |
| `import.applied` | import apply | created, duplicate, rejected, raced |
| `share.published` | publish | visibility, section count |
| `ai.request` | AI research | intent, model, tokens, latency, coverage |
| `push.send_failed` | Web Push | status, endpoint **origin** |

### Describing an error safely

`describeError(error)` is how a thrown value becomes fields. It exists because two obvious
approaches are both wrong:

- `String(error)` yields `[object Object]` for a supabase-js error, which is a plain object rather
  than an `Error`. The catch-all in `guarded()` used to log exactly that.
- Spreading the error is worse: a Postgres error carries `details` and `hint`, and on a unique
  violation **those contain the values of the conflicting row** — a portfolio's data, in a log.

So it takes a name, a code and the library's own message, and refuses the rest.

### What is never logged

Password, JWT, session token, refresh token, share token, API key, VAPID private key, AI prompt or
answer, journal or thesis content, and any portfolio figure. `lib/log.ts` redacts by field name and
by value shape, but **the call sites are the real guarantee** — a denylist can always be walked
around by a new field name. If you find one of these in a log, fix the call site, not the list.

A push endpoint is logged as its **origin** and never in full: the full URL is a bearer capability.

## 3. Health checks

| Endpoint | Question | Dependencies probed |
|---|---|---|
| `/api/health` | Is this function running? | none |
| `/api/ready` | Can it serve a request? | Postgres, and nothing else |

Liveness touches no database on purpose: a health check that queries the database reports the
application as down during a database blip, which is how a load balancer turns a recoverable
incident into an outage.

Readiness does **not** probe the market-data provider or the model. Both are third parties the
application is designed to survive without — a quote outage falls back to cost basis and says so,
and AI failing costs the assistant alone. Reporting not-ready because somebody else's API is slow
would take the site down over a degradation already handled.

Its result is cached for 10 seconds so an unauthenticated probe cannot be turned into a way to make
the database do work. Neither endpoint discloses which provider is configured, whether AI is on, or
an environment name.

## 4. Durable job history

Logs are for the last few days; `job_executions` is the record. Each scheduled run writes a row with
the job name, start and end, status (`RUNNING · OK · PARTIAL · FAILED`), processed/succeeded/failed
counters and a short error summary — **never a figure and never a provider payload**. It is
select-only for signed-in users through RLS; only the service-role job writes to it.

That is what the data-quality page reads to say when prices were last refreshed, and what to check
first when someone reports stale prices.

## 5. Metrics

Stockly emits no metrics protocol. The counters that would populate one are already in the log
lines above — `api.request` has route, status and latency; `market-data.fetch` has attempt and
latency; the cron events carry their own counters — so a log-based dashboard can compute request
rate, error rate, latency percentiles, provider failure rate and job success rate without any code
change.

A metrics client is deliberately not installed. It would be a dependency, a flush problem in a
serverless function, and a second place for the same numbers to live, in exchange for dashboards
that can be built from what is already emitted.

## 6. Error monitoring

Not integrated, and not stubbed. There is one place a reporter would go — the catch-all in
`guarded()`, which already has the request id, the route and a safely-described error — so adding
Sentry or similar is a few lines at a single call site rather than a refactor. An external service
that receives every error is a privacy decision as well as an operational one, and it is left to be
made deliberately rather than defaulted into.

## 7. Debugging workflow

**A user reports a failure.** Ask for the reference id on the error card. Search it. `api.request`
gives the route, status and latency; `api.error` gives the code. If a provider was involved,
`market-data.fetch` for the same id shows the attempt count and whether it retried.

**Prices look wrong or old.** `job_executions` for `data` — when did the refresh last run and what
did it do? A run that refreshed no market is usually correct: every market was closed. Then the
data-quality page, which counts stale prices and missing rates against the same cached analytics
pass the dashboard uses, so the two cannot disagree.

**An import did not do what someone expected.** `GET /api/imports/:id` shows counters and every
`DUPLICATE` or `REJECT` row with a reason. The file itself is not stored — ask them to re-run the
preview, which writes nothing.

**A shared page is showing the wrong thing.** `published_shares` holds exactly what visitors see.
`share_events` shows what the owner changed and when. A `share.publish_failed` line means the
rebuild failed and the published row was deleted rather than left stale.

**Latency.** `api.request` carries `latencyMs` for every request, and `market-data.fetch` carries
its own — so "slow request" and "slow provider" are distinguishable from the logs alone, without
tracing.

## 8. Privacy of the telemetry itself

Stockly records no IP history, no user agent, no referrer, no geography and no fingerprint. Share
links count accesses and keep a last-seen timestamp, and that is the entire extent of viewer
analytics — "who looked at my portfolio" is a question this application chooses not to be able to
answer.

A `userId` appears in exactly one log event (`notifications.insert_failed`), because it is how a
support conversation about a missing notification gets resolved. It is an opaque uuid.
