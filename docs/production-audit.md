# Production Audit — Phase 14

An audit of Stockly as it stands after phase 13, carried out by reading the code rather than by
recalling what earlier phases claimed. Every finding below cites the file it came from; anything
that could not be verified in this environment says so instead of guessing.

**Scope note.** Phase 8 already hardened this application, and most of what follows confirms that
work rather than replacing it. The findings are the places where reality and the documentation had
drifted apart, plus the gaps nobody had looked at yet.

## Summary

| Severity | Count | Fixed in this phase |
|---|---|---|
| CRITICAL | 0 | — |
| HIGH | 2 | 2 |
| MEDIUM | 5 | 4 |
| LOW | 4 | 1 |

Nothing found was exploitable by one user against another. The two HIGH findings are both cases of
a **documented guarantee that was not true** — which is its own category of danger, because it is
the kind of thing an operator relies on during an incident.

---

## Findings

### H-1 · Reliability · A bounded retry was documented but did not exist

| | |
|---|---|
| **Area** | Market data / provider reliability |
| **Current state** | `CLAUDE.md` stated "Every external call has a timeout and a bounded retry. Retry a rate limit, a timeout and a transient outage; never a bad key or an unusable response." `services/benchmark/twelve-data-provider.ts:10` said calls "inherit the timeout, the retry, the Next Data Cache". **`services/market-data/http.ts` had a timeout and no retry at all.** The AI layer did have one (`services/ai/structured.ts`), which is likely where the belief came from. |
| **Risk** | A single dropped connection or one unlucky 502 put the whole portfolio onto the cost-basis fallback. Worse, an operator reading the runbook during an incident would rule out transient failure on the strength of a retry that was never there. |
| **Severity** | **HIGH** |
| **Recommendation** | Implement the retry the documentation describes, bounded at two attempts, retrying only what could plausibly differ 250ms later. |
| **Implemented?** | **Yes.** `services/market-data/http.ts` now retries once with a 250ms backoff. Retryability is carried on the error (`MarketDataError.retryable`, mirroring the `AIError` shape that already existed) rather than inferred from the code, because a 401 and a 502 are both "unavailable" to a caller and only one is worth asking again. `services/market-data/retry.test.ts` asserts which failures are retried and which are not, and that a persistent outage costs two requests rather than a storm. **The status codes callers see are unchanged.** |

### H-2 · Observability · Unstructured logging across the server

| | |
|---|---|
| **Area** | Logging |
| **Current state** | 24 bare `console.*` calls in server code — cron, alerts, AI, technical snapshots, analytics, notifications, the market-data fetch — against a documented rule that logging is structured and goes through `lib/log.ts`. Several passed a **raw error object**: `features/analytics/portfolio-analytics.ts:470` logged a Supabase error whole, and a Postgres error's `details` and `hint` quote **the values of the conflicting row**. |
| **Risk** | Portfolio data in a log platform. Unsearchable operational events. A request could not be traced from its id to the failure it caused. |
| **Severity** | **HIGH** |
| **Recommendation** | Route every server log through `logger`, and give it a safe way to describe a thrown value. |
| **Implemented?** | **Yes.** All 24 converted to `logger` with stable dotted event names. Added `describeError()` in `lib/log.ts`, which takes a name, a code and a message and **refuses `details` and `hint`**. Three client-side `console` calls remain deliberately (`app/(app)/error.tsx`, `features/pwa/components/service-worker.tsx`): they run in the user's browser, where structured JSON reaches nobody and the server has already logged the failure against its request id. |

### M-1 · Observability · The catch-all logged nothing usable

| | |
|---|---|
| **Area** | Error handling |
| **Current state** | `lib/api.ts`'s `guarded()` fallback logged `message: error instanceof Error ? error.message : String(error)`. supabase-js throws a **plain object**, not an `Error` — so the single most important branch in the application's error handling recorded `[object Object]`. |
| **Risk** | A production database failure produced a request id, a 500, and a log line with no information in it. |
| **Severity** | **MEDIUM** |
| **Implemented?** | **Yes.** `guarded()` now uses `describeError()`. Covered by `lib/log.test.ts`. |

### M-2 · Caching · API responses carried no cache directive

| | |
|---|---|
| **Area** | Caching / API |
| **Current state** | Neither `ok()` nor `fail()` set `Cache-Control`. Every route handler is dynamic and Vercel does not edge-cache those, so nothing was actually being cached — but nothing said so either. |
| **Risk** | Low today; catastrophic if it ever stops being true, because **every** endpoint in this application is authenticated and user-specific. One user's holdings served to the next is the worst bug it could have. |
| **Severity** | **MEDIUM** |
| **Implemented?** | **Yes.** `private, no-store` on every API response, success and failure alike. One header removes the question permanently. |

### M-3 · Data freshness · One question, two answers

| | |
|---|---|
| **Area** | Data freshness |
| **Current state** | "How old is too old?" was answered in four files. `domain/alerts.ts` used `15`. `domain/data-quality.ts` used a **copied literal `15`** under a comment claiming it "matches the alert engine" — a claim nothing enforced. `domain/insights.ts` used `30`. `features/technical/snapshots.ts` used `90`. Three of those are deliberate; one was a duplicate waiting to drift. |
| **Risk** | Not user-visible today. The copied literal is the defect: the next person to change the alert threshold changes one of two numbers, and the data-quality page starts disagreeing with the alert engine about what "delayed" means. |
| **Severity** | **MEDIUM** |
| **Implemented?** | **Yes.** `domain/freshness.ts` holds four **named** policies, and the four modules read from it. `domain/freshness.test.ts` asserts they still agree, and asserts the values are what they were — **centralising a constant is not a licence to redefine when a price is stale**. The insight/alert divergence is now documented as a decision (an insight is a sentence somebody reads; an alert is money) rather than discovered as an inconsistency. |

### M-4 · Data integrity · Read-then-write race on a sell

| | |
|---|---|
| **Area** | Transaction integrity |
| **Current state** | `app/api/transactions/route.ts` recomputes the position server-side and calls `canSell` before inserting. The read and the write are not atomic, so two concurrent sells could both pass. |
| **Risk** | Bounded, and only against oneself. The engine is the backstop: `domain/holdings.ts:85` clamps a sell to the quantity held, so the worst outcome is a sell recorded for fewer shares than requested — **never a negative position propagating through every later figure**. |
| **Severity** | **MEDIUM** (would be HIGH without the clamp) |
| **Recommendation** | Fixing it properly means a serializable transaction or a Postgres function that validates and inserts in one statement. That is a change to the write path of the most important table in the application, for a race a single user has to create against themselves. Not worth doing inside a hardening phase. |
| **Implemented?** | **No — documented and tested instead.** `domain/invariants.test.ts` proves the clamp holds and that a zero-share sell never enters the trade statistics. Listed under Remaining Risks. |

### M-5 · Privacy · A push endpoint is a capability, and 60 characters of it were logged

| | |
|---|---|
| **Area** | Notifications / privacy |
| **Current state** | `services/notifications/push.ts` logged `subscription.endpoint.slice(0, 60)` on a send failure. A push endpoint URL is a bearer capability: anyone holding it can push to that device. |
| **Risk** | Low — 60 characters is usually just the service origin and the start of the token — but it is the wrong thing to be truncating rather than the wrong length. |
| **Severity** | **MEDIUM** |
| **Implemented?** | **Yes.** Logs `new URL(endpoint).origin` only, which is what actually answers the operational question ("is Firefox's service failing?") and discloses nothing. |

### L-1 · Serverless · In-memory state, correctly scoped

| | |
|---|---|
| **Current state** | Three pieces of module-level mutable state: the rate-limit window map (`lib/rate-limit.ts`), the readiness probe cache (`app/api/ready/route.ts`, 10s), and the benchmark availability flag. All three are per-instance and all three are documented as such. |
| **Risk** | None to correctness. The rate limiter's real ceiling is `limit × instances`, which its own comment already says. The controls that hold — database caps, the cron secret, RLS — do not depend on it. |
| **Severity** | **LOW** |
| **Implemented?** | No change needed. Verified, not modified. |

### L-2 · Logging · A user id is written on a notification failure

`services/notifications/index.ts` logs `userId` when an insert fails. Defensible — it is how a
support conversation about a missing notification gets resolved — and it is an opaque uuid, not
PII. Left as is, recorded here so it is a decision rather than an oversight.

### L-3 · Dependencies · Clean

`npm audit --audit-level=high --omit=dev` and `npm audit --audit-level=high` both report **0
vulnerabilities**. No deprecated runtime dependency. The one place a dependency was refused on
security grounds — the `xlsx` package, which carries open advisories — is documented in
`lib/xlsx.ts` and remains hand-written.

### L-4 · Health · Readiness probes one dependency

`/api/ready` probes Postgres and nothing else, deliberately: reporting the app as not-ready because
a third party is slow would take the site down over a degradation it already handles. Correct as
designed. Recorded because §29 asks the question.

---

## Verified with no finding

Each of these was read and found already correct. They are listed so the audit is a statement about
coverage, not just about problems.

| Area | What was checked | Result |
|---|---|---|
| **Architecture** | Layering, one-way dependency, no second calculation engine | Holds. Four structural tests enforce it (`intelligence-boundary`, `simulation/invariants`, `import/invariants`, `sharing-boundary`), now joined by `domain/invariants.test.ts`. |
| **Authentication** | Supabase Auth, cookie flags, middleware refresh | `httpOnly`, `sameSite=lax`, `secure` in production, `path=/`. No custom auth, no credential storage. |
| **Authorization / IDOR** | Every user-owned table | `user_id` + RLS + composite FK to `(portfolio_id, user_id)`. No handler accepts a `user_id` from a body. A resource that is not the caller's returns **404, not 403**. |
| **Public sharing** | Anonymous grants | The anonymous role can read one table where `visibility = 'PUBLIC'`, plus two `security definer` functions with pinned `search_path`. No path from an anonymous request to `transactions`. |
| **Share tokens** | Entropy, storage, revocation | 32 CSPRNG bytes, SHA-256 at rest, shown once. Expiry and revocation evaluated inside the statement that reads the row. |
| **Cron security** | Both jobs | Shared secret, constant-time compare, **rejects everything when unset**. Bounded `maxDuration`. Safe to run twice. |
| **Import** | Untrusted file handling | Size, row, column and cell caps before parsing; 40MB per inflated zip entry; format from magic bytes; values never formulas; nothing written to disk; preview writes nothing. |
| **Security headers** | CSP and static headers | Nonce-based CSP, `object-src 'none'`, `frame-ancestors 'none'`, HSTS in production only, full `Permissions-Policy`. |
| **PWA cache** | `public/sw.js` | Non-GET returns early; `/api/**` and `/auth/**` return early; navigations are network-only with an offline fallback; only build-immutable assets are cached. |
| **Pagination** | List endpoints | Transactions, dividends, cash, notifications, imports and journals all paginate; the calculation engine reads the full history, never a page. |
| **Payload limits** | Request bodies | 64KB default, 2MB for import, checked by declared length **and** measured bytes before `JSON.parse`. |
| **Null semantics** | Financial metrics | No `?? 0` on a missing financial figure anywhere in `domain/`. Untranslated holdings, missing previous closes, thin risk samples and unavailable benchmarks all produce `null` → `N/A`. |
| **Precision** | Money arithmetic | `domain/money.ts` scaled integers at every accumulation point. Now also covered by explicit float-error tests in `domain/invariants.test.ts`. |
| **AI safety** | Default configuration | `AI_ENABLED=false` by default; CI builds with AI off **and** on. Not enabled in this phase. |
| **Vercel compatibility** | Filesystem, long-running work, connections | No filesystem writes; Supabase over HTTP so no connection pool to exhaust; no work scheduled after a response. |

---

## Not measured

Stated rather than estimated, per §75:

- **Performance before/after: not measured.** No load test was run and no production baseline exists,
  so this phase reports no latency numbers. The request-cost analysis in `docs/PERFORMANCE.md` is
  by-design accounting (upstream credits and database round trips per request), not measurement.
- **The migration for phase 13 has not been applied to a database in this environment.** Its
  policies are asserted structurally by `supabase/sharing-policies.test.ts`.
- **E2E was enumerated, not executed** — it needs a running app and a real database.
- **No penetration test.** The IDOR and leakage findings above come from reading the code and from
  automated tests, not from an adversarial exercise against a running deployment.
