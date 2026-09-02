# Security Checklist

One row per control, with the thing that makes it true. **A row says PASS only if it was actually
checked** — by reading the code, by a test, or both. Where something was not verified in this
environment it says NEEDS REVIEW and why, rather than borrowing confidence from a design document.

Last reviewed: phase 14.

| # | Control | Status | Evidence |
|---|---|---|---|
| 1 | **Authentication** | PASS | Supabase Auth owns credentials; no password is stored, hashed or compared by this codebase. `lib/supabase/middleware.ts` calls `getUser()` — verified against the auth server, never read from a cookie. |
| 2 | **Session cookies** | PASS | `httpOnly`, `sameSite=lax`, `secure` in production, `path=/`, set in `lib/supabase/middleware.ts`. Dropped `secure` in development only, where the origin is `http://localhost`. |
| 3 | **Session invalidation** | PASS | `app/auth/signout` ends the session and clears the query cache and every service-worker cache before doing so. |
| 4 | **Authorization** | PASS | Every user-owned table has `user_id`, RLS enabled and four explicit policies. Isolation is the database's, not a handler's. |
| 5 | **IDOR** | PASS | Child rows carry a composite foreign key to `(portfolio_id, user_id)`, so a row cannot reference a portfolio the caller does not own. No handler accepts a `user_id` from a request body — asserted for sharing in `features/sharing/schema.test.ts`. |
| 6 | **Resource enumeration** | PASS | A resource that is not the caller's returns **404, not 403**. Confirming that an id exists is information. |
| 7 | **CSRF** | PASS | No cookie-authenticated state-changing form posts cross-origin: `sameSite=lax` plus `form-action 'self'` plus JSON-only mutations that a cross-site form cannot produce. |
| 8 | **XSS** | PASS | React text nodes throughout. No `dangerouslySetInnerHTML` anywhere in the application. Model output specifically is rendered as text with no markdown parser — `features/ai`. |
| 9 | **SQL injection** | PASS | Every query goes through PostgREST via supabase-js with parameter binding. No string-built SQL. The two `security definer` functions take a single hashed parameter and pin `search_path`. |
| 10 | **Injection via enums** | PASS | Alert conditions, screener filters, goal types, import fields, share visibility and template are all closed enums validated by Zod and again by `check` constraints. No client-supplied expression is ever interpreted. |
| 11 | **CSV formula injection (out)** | PASS | `lib/csv.ts` escapes a leading `= + - @` on export. Tested. |
| 12 | **Spreadsheet formula execution (in)** | PASS | `lib/xlsx.ts` reads the cached `<v>` value and never touches `<f>`. Tested against a fixture built by Python's `zipfile`. |
| 13 | **File upload — size** | PASS | 2MB body cap checked by declared `Content-Length` **and** measured bytes before parsing; 5000 rows, 60 columns, 500 characters per cell. |
| 14 | **File upload — zip bomb** | PASS | `MAX_ENTRY_BYTES` 40MB per inflated entry in `lib/xlsx.ts`. |
| 15 | **File upload — type** | PASS | Format decided by **magic bytes**, never extension or `Content-Type`. Binary posing as CSV is caught by replacement-character detection after decoding. |
| 16 | **File upload — filename** | PASS | Never used as a path or in any filesystem call; rendered as text only. Asserted in `features/imports/schema.test.ts`. |
| 17 | **File upload — storage** | PASS | Nothing is written to disk. The bytes are parsed in the request that received them and dropped, so there is no retention, encryption-at-rest or deletion path to get wrong. |
| 18 | **Import idempotency** | PASS | Partial unique index on `(user_id, import_fingerprint)`. A `23505` retries row by row. The guarantee is the database's; the application check is an optimisation. |
| 19 | **Rate limiting** | PASS (with a stated limit) | Applied to every paid upstream and every expensive path. The limiter is **in-memory and per-instance** — a brake on loops, not a security control, and its own comment says so. The controls that hold are the database caps, the cron secret and RLS. |
| 20 | **Login brute force** | N/A | Supabase Auth rate-limits sign-in attempts. A second, weaker limiter in front of it would not improve on that. |
| 21 | **Share token — entropy** | PASS | 32 bytes from `node:crypto.randomBytes`, base64url. Not a uuid: v4 carries 122 bits, v7 encodes its creation time. `lib/share-token.test.ts` asserts length, uniqueness over 500 draws, and that consecutive tokens share no prefix. |
| 22 | **Share token — storage** | PASS | Only the SHA-256 is stored, constrained to `^[0-9a-f]{64}$`. The raw token exists in the response that created it and nowhere else — never logged, never in an audit row, not recoverable. |
| 23 | **Share token — revocation** | PASS | `revoked_at` and `expires_at` are evaluated inside the same statement that reads the row; token pages are `revalidate = 0`, so nothing cached can outlive a revocation. |
| 24 | **Public DTO leakage** | PASS | `domain/sharing-leak.test.ts` walks the real published document across every settings combination, checking forbidden **keys** and planted private **values**. `features/sharing/source.test.ts` covers the other half — that a journal, thesis, goal note or broker reference never reaches the projector. |
| 25 | **Privacy semantics** | PASS | PRIVATE / LINK_ONLY / PUBLIC verified: the anonymous role's whole grant is one table where `visibility = 'PUBLIC'`. A private portfolio, revoked link, expired link, deleted snapshot and non-existent address all return the same nothing. |
| 26 | **Sensitive logging** | PASS | `lib/log.ts` redacts by field name and by value shape; `describeError()` refuses Postgres `details` and `hint`, which quote the conflicting row. All 24 unstructured `console` calls were converted in phase 14. Push endpoints are logged as an origin, not a capability URL. |
| 27 | **Secrets in code** | PASS | Only `.env.example` is tracked. `lib/env.server.ts` imports `server-only` so a client import is a build error. The provider key is appended to a URL after the loggable form is taken. CI runs a secret scan. |
| 28 | **Security headers** | PASS | Nonce-based CSP, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`, `nosniff`, `strict-origin-when-cross-origin`, full `Permissions-Policy`, HSTS in production only. `lib/security-headers.test.ts`. |
| 29 | **Cache leakage — HTTP** | PASS | Every API response carries `private, no-store` (added in phase 14). Public share pages carry only already-public content, by construction. |
| 30 | **Cache leakage — PWA** | PASS | `public/sw.js` returns early for non-GET, for `/api/**`, for `/auth/**` and for other origins; navigations are network-only with an offline fallback; only build-immutable assets are cached. Sign-out wipes every cache. |
| 31 | **Cron security** | PASS | Shared secret via `Authorization: Bearer` or `x-cron-secret`, constant-time compare, and **an unset secret rejects everything**. Tested in `features/alerts/cron-auth.test.ts` and `features/automation/refresh.test.ts`. |
| 32 | **Service-role key** | PASS | Created in exactly one module (`lib/supabase/admin.ts`) and used only by the scheduled jobs. **No request path imports it** — including all of phase 13's sharing, which is why public pages read a published projection rather than a portfolio. |
| 33 | **Dependency vulnerabilities** | PASS | `npm audit --audit-level=high` and `npm run audit:ci` both report 0, verified in this phase. |
| 34 | **Error disclosure** | PASS | No stack trace, Postgres message, SQL or provider text reaches a client. A stable code and a request id do. `lib/api.test.ts`. |
| 35 | **Provider key disclosure** | PASS | The key is appended after the loggable URL is captured, so no log line or error message can contain it. `services/market-data/retry.test.ts` asserts it. |
| 36 | **AI safety** | PASS | `AI_ENABLED=false` by default; CI builds both ways. The model gets no tools, no system-role user input, and its output is Zod-validated and rendered as text. Not enabled in this phase. |
| 37 | **Push payload privacy** | PASS | No portfolio value, return or weight in a push payload — a lock screen is not a private surface. Prices are public and are named. |
| 38 | **Transaction integrity** | NEEDS REVIEW | Server-side `canSell` recheck, `user_id` from the session, check constraints, and an engine that clamps rather than going negative. But the check and the insert are **not atomic** — see M-4 in `production-audit.md`. Bounded, self-inflicted only, and covered by `domain/invariants.test.ts`; not fixed. |
| 39 | **Row-level security coverage** | NEEDS REVIEW | Every migration enables RLS with explicit policies, and `supabase/sharing-policies.test.ts` asserts phase 13's structurally. **No migration has been applied to a live database in this environment**, so the policies have not been exercised by a real anonymous or second-user session. This is the single largest gap in the checklist. |
| 40 | **Cross-user testing** | NEEDS REVIEW | Isolation is enforced by constraints and asserted by unit and structural tests. A two-account manual pass against a running deployment has not been done here. |

## What would close the NEEDS REVIEW rows

Three of the four need the same thing: **a database**. Apply the migrations to a Supabase project,
then run a two-account exercise — user A creates a portfolio, a share link and a snapshot; user B
attempts to read, update and delete each by id; an anonymous session attempts the same plus a
guessed slug and a revoked token. Every attempt should return nothing, and the RLS policies are
then exercised rather than merely asserted.

Row 38 needs a decision rather than a test: whether the write path of the transactions table is
worth changing for a race a single user has to create against themselves.
