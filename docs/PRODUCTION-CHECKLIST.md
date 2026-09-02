# Production checklist

Every box is either ticked with the thing that makes it true, or left open with the reason. A
checklist of unexplained ticks is decoration.

Legend: **✅** done and verified · **⚠️** done with a stated limitation · **☐** deliberately not done

---

## Environment

- ✅ Three environments separated — development, preview, production — with their own Supabase
  projects. [PRODUCTION-ARCHITECTURE.md](PRODUCTION-ARCHITECTURE.md) §3.
- ✅ `.env.example` groups every variable by concern and contains no real value.
- ✅ `NEXT_PUBLIC_APP_URL` falls back to `VERCEL_PROJECT_PRODUCTION_URL`, so a preview produces
  correct absolute URLs with no configuration.
- ✅ Node pinned: `.nvmrc` (22.20.0) and `engines.node` in `package.json`. CI reads `.nvmrc`.
- ✅ `npm ci` in CI — installs exactly the lock file or fails.
- ☐ Development is not *prevented* from pointing at the production database. It is an environment
  variable, and no code can stop it. Stated as a rule, in the architecture doc and here.

## Secrets

- ✅ Every secret is server-only, read through `lib/env.server.ts`, which imports `server-only` — a
  client import is a build error.
- ✅ No `NEXT_PUBLIC_` variable holds a secret. Asserted by a test against `.env.example` and
  `lib/env.ts`.
- ✅ Verified after a production build that no key and no provider name appears in `.next/static`.
- ✅ `.gitignore` covers `.env*`; only `.env.example` is tracked, and CI fails the build if that
  changes.
- ✅ `gitleaks` runs on every push and pull request over the full history.
- ✅ No secret is ever logged: the logger redacts by field name and by value shape, and a test
  greps the AI sources for a log call that mentions a key, a prompt or an answer.
- ✅ The service-role key is used in exactly one place — the scheduled job, behind the cron secret.

## Authentication

- ✅ Supabase Auth owns credentials. No password is stored or hashed by this application.
- ✅ Sessions are HTTP-only cookies, `SameSite=Lax`, and `Secure` in production.
- ✅ The session is verified against the auth server on every request (`getUser()`), never read
  from a cookie claim.
- ✅ An expired or invalid session degrades to signed-out: pages redirect, API calls return 401.
- ✅ Signing out clears the query cache and every service-worker cache before ending the session.
- ☐ No OAuth provider is configured. Email and password only — adding one is Supabase
  configuration, not code.
- ☐ No account deletion in the UI. Supabase Auth deletes the user and the schema cascades; a
  self-service button is a phase-9 feature, not a hardening item.

## Authorization

- ✅ Row-level security on every user table, default-deny, explicit policy per operation.
- ✅ No endpoint accepts a `user_id`. It always comes from the session.
- ✅ IDOR: every `:id` route filters through RLS and returns `404` rather than `403` — a 403
  confirms the id exists. Verified across portfolios, transactions, dividends, cash, alerts,
  notifications, saved screens and AI conversations.
- ✅ `portfolioId` in a body is *resolved* against the caller's own portfolios, never trusted.
- ✅ **Fixed in phase 8:** child rows could reference another user's portfolio. Composite foreign
  keys on `(portfolio_id, user_id)` now make it impossible in the database rather than by
  convention. Migration `20260901060000`.
- ✅ Same for `ai_messages` → `ai_conversations`.

## API

- ✅ Every route goes through `guarded()`: config check → session → handler → shared envelope.
- ✅ Every body and query parameter is validated by Zod at the boundary.
- ✅ Request bodies capped at 64 KB, checked by declared length *and* by measured bytes, before
  `JSON.parse`. App Router handlers have no default limit.
- ✅ Consistent envelope and stable error codes across every endpoint. [API.md](API.md).
- ✅ No stack trace, Postgres message or provider text reaches a client.
- ✅ Lists are paginated. **Fixed in phase 8:** `GET /api/transactions` returned an unbounded list.
- ✅ **Fixed in phase 8:** an unauthenticated API call was being 307-redirected to `/login`, so a
  `fetch` client received HTML. It now returns a JSON 401.

## Injection and output safety

- ✅ SQL: every query is a parameterised Supabase call. No string concatenation anywhere.
- ✅ Screener and AI-proposed filters are closed enums — `metric`, `operator`, `value` — with no
  field that is ever interpreted. `null` and booleans are rejected rather than coerced to `0`.
- ✅ XSS: no `dangerouslySetInnerHTML`, no `innerHTML`, no markdown parser and no sanitiser
  anywhere in `features/ai`. Model output renders as React text nodes, which escape by
  construction. Asserted by a test.
- ✅ Prompt injection: separated by type (`AIMessage` has no `system` role), by position (data in
  a labelled block), by instruction, and by an output check against a forbidden-language list.
- ✅ The model has no tools. Retrieval finishes before it is called.
- ✅ Notes and other free text render as React text nodes.

## Transport and headers

- ✅ CSP, nonce-based, **enforced** — verified end to end that every inline script on every page
  carries the nonce. Every scripted route is server-rendered for exactly this reason.
- ✅ `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
- ✅ `connect-src` is same-origin plus the Supabase origin. No wildcard.
- ✅ HSTS, two years, `includeSubDomains`, `preload` — production only.
- ✅ `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options`, `Permissions-Policy`,
  `Cross-Origin-Opener-Policy`. `X-Powered-By` removed.
- ✅ `Cache-Control: private, no-store` on every `/api/**` response.
- ⚠️ `style-src` allows `'unsafe-inline'`. Required: React writes the `style` prop as an attribute
  and nonces do not apply to attributes. Documented at the directive.
- ☐ No CORS configuration. Deliberate — there is no cross-origin API surface, so the browser's
  same-origin default is the correct and tightest policy. Adding permissive headers would only
  loosen it.
- ☐ No CSRF token. Deliberate — Supabase session cookies are `SameSite=Lax`, which blocks
  cross-site POSTs, and every mutation is a `fetch` with `Content-Type: application/json`, which is
  not a simple request and therefore preflighted. Revisit if a form ever posts natively or a cookie
  becomes `SameSite=None`.

## Rate limiting and abuse

- ✅ Per-user, per-minute limits on everything that costs money: AI (6), market data (20–60 by
  endpoint), screener (30), alerts (20), push (10).
- ✅ Exchange rates are cached for 10 minutes in the Next Data Cache, shared across instances, and
  requested per currency **pair** rather than per holding: a fifty-holding, two-currency portfolio
  costs one FX request per window for the whole deployment. A single-currency portfolio costs none.
- ✅ **Fixed in phase 8:** the four market-data routes had no limit at all, despite each one
  spending upstream credits.
- ✅ AI daily quota counted in `ai_usage`, so it survives instances and deploys, and **fails closed**
  if the count cannot be read.
- ✅ Hard per-user caps enforced by the database: 100 alerts, 30 saved screens.
- ⚠️ The per-minute limiter is in-memory and per instance. Honest about being a brake on loops, not
  a security control; the controls that hold are the database caps, the cron secret and RLS.
- ☐ No login brute-force protection of our own. Supabase Auth rate-limits sign-in attempts; adding
  a second, weaker limiter in front of it would not improve on that.

## Database

- ✅ Every schema change is a migration file, forward-only, never edited after being applied.
- ✅ RLS enabled on every user table; `technical_snapshots` is shared reference data, readable by
  any signed-in user and written only by the job.
- ✅ Foreign keys with deliberate `on delete` behaviour; check constraints for invariants.
- ✅ `numeric` for every money and quantity column. Never `float8`.
- ✅ Indexes on every foreign key and on the columns actually filtered and sorted. Two added in
  phase 8, both partial, both matching a real query; phase 9 widened the transactions symbol index
  to `(portfolio_id, market, symbol)`, which is how the engine now groups positions.
- ✅ **Added in phase 9:** `check` constraints on `transactions.market` and on the `currency` columns
  of `portfolios`, `dividends` and `cash_transactions`. A market or currency the app cannot price
  would be routed to the wrong provider and valued in the wrong unit — a silently-wrong number
  rather than a visible error — so it is now unstorable rather than merely rejected in TypeScript.
- ✅ No connection pool to exhaust — Supabase is reached over HTTP, not the Postgres wire protocol.

## Reliability

- ✅ Timeouts on every external call: market data 8 s, AI 25 s (configurable), function 60 s.
- ✅ Bounded retries with exponential backoff and jitter, on retryable failures only. Never on a
  bad key or an unusable response.
- ✅ Graceful degradation: a market-data outage falls back to cost basis and says so; an AI outage
  costs the assistant and nothing else; a missing service worker costs offline navigation.
- ✅ **Per-market and per-currency isolation (phase 9):** one market's provider failing leaves the
  other's holdings priced and names the failed one; an FX provider failing renders converted figures
  as "N/A" — never 0, never a fabricated rate — and the page states how many holdings were excluded.
  A missing exchange rate can therefore make a total incomplete, but never wrong.
- ✅ Liveness and readiness are separate probes. Readiness checks Postgres and deliberately not the
  third parties Stockly is built to survive without.
- ✅ Alerts are idempotent — a unique key makes a duplicate run a no-op — and fire on a crossing,
  not a comparison.
- ✅ Push failures with 404/410 delete the subscription; anything else is left alone.
- ☐ No circuit breaker. The provider is already fronted by a cache, a timeout and a bounded retry,
  and every failure path already degrades rather than cascades. A breaker would add state to a
  stateless function for a failure mode that is already handled.
- ☐ No idempotency key on transaction creation. A double-submitted buy is visible, editable and
  deletable by the user, and inventing a key for a form nobody double-submits is speculative.

## Observability

- ✅ Structured JSON logs with a stable event name, level, request id, route, status and latency.
- ✅ Request id on every request, echoed in `X-Request-Id` and in the error envelope, so a user's
  screenshot maps to a log line. An upstream id is preferred; a client-supplied one is validated.
- ✅ Log level defaults to `info` in production.
- ✅ AI usage ledger: provider, model, intent, symbols, tokens, estimated cost, latency, status.
- ✅ Market-data latency and status logged on every call, never the key.
- ☐ No error-tracking service. Vercel captures the logs and the volume does not justify a second
  vendor with a second data-processing agreement. Insertion point: the `emit` function in
  `lib/log.ts`.
- ☐ No alerting on error rate. Needs a monitoring provider; the runbook says what to look at.

## Performance

- ✅ Charts, AI and the screener load through `next/dynamic`; verified the chart library is absent
  from the login page.
- ✅ Fonts self-hosted at build time — no CDN round trip.
- ✅ One batched quote call prices a whole portfolio; a screen costs zero upstream requests.
- ✅ **Fixed in phase 8:** company profiles were fetched for every symbol ever traded rather than
  for symbols currently held.
- ✅ Budgets recorded in [PERFORMANCE.md](PERFORMANCE.md) with measured numbers.
- ⚠️ `/login` ships 1,346 KB uncompressed, ~250 KB of it the Supabase browser client. The fix —
  moving auth to a server action — was deliberately deferred to a change that can be tested against
  a live auth server.
- ☐ Core Web Vitals not measured. Needs a deployed environment with real data; recording a
  synthetic number would be worse than recording none.
- ☐ No load test. The binding constraint is the provider's 8 credits per minute, which no tuning
  moves.

## PWA

- ✅ Manifest, icons (192, 512, maskable), Apple touch icon, theme colour, `standalone`.
- ✅ Service worker caches **nothing authenticated** — no `/api/**`, no `/auth/**`, no navigation
  response, no other origin, no non-GET.
- ✅ Updates are offered, never forced; versioned by `APP_VERSION` in the worker's URL.
- ✅ Offline navigation falls back to `/offline`, which never presents stale data as live.
- ✅ Sign-out clears every service-worker cache.
- ✅ Touch targets use `pointer-coarse:`, not a width breakpoint.
- ✅ iOS gets instructions rather than a fake install button — Safari has no install API.

## SEO

- ✅ `robots.txt` allows the six public paths and disallows everything else, including `/api/`.
- ✅ `sitemap.xml` lists public pages only.
- ✅ The entire signed-in area is `noindex, nofollow` — three independent reasons it cannot be
  indexed.
- ✅ Open Graph and Twitter card metadata with a generated 1200×630 image.
- ✅ `metadataBase` and a canonical URL.

## Accessibility

- ✅ Semantic landmarks, heading hierarchy, labelled forms and buttons.
- ✅ Keyboard navigation and visible focus throughout; dialogs trap focus and close on Escape.
- ✅ Pinch-zoom is never disabled.
- ✅ Colour never carries meaning alone — every gain or loss shows its sign and its percentage.
- ✅ Light, dark and system themes are all first-class.
- ⚠️ Charts have no screen-reader summary. Every figure a chart shows is also present as text in
  the same view, so nothing is unreachable — but a dedicated summary would be better.
- ☐ No automated axe run in CI, and no manual screen-reader pass on a real device.

## Testing

- ✅ 516 unit and integration tests across 29 files, covering the money paths, the indicators, the
  screener, the alert state machine, the AI grounding and safety rules, the security headers and
  the logger.
- ✅ Security tests: prompt injection, XSS, secret exposure, closed-enum validation, request size,
  error redaction.
- ✅ E2E smoke suite **executed and passing** against a local production build, desktop and mobile
  (14 passed, 2 skipped — the two that need a database). It caught a real defect: next-themes
  injects an inline script that the enforcing CSP was blocking.
- ⚠️ The critical-journey spec has **not been executed** — it needs a test account in a real
  database, which does not exist in this environment. It skips itself and says so when
  `E2E_EMAIL`/`E2E_PASSWORD` are unset. `tests/e2e/README.md` says how to run it.
- ☐ No coverage threshold. The `domain/` rule ("calculations must be tested, including the awkward
  cases") is enforced by review, not by a percentage.

## Deployment

- ✅ CI: lint, typecheck, test, build with AI off *and* on, dependency audit, secret scan.
- ✅ `npm run verify` runs locally exactly what CI runs.
- ✅ Rollback documented and instant — promote the previous Vercel deployment.
- ✅ Migrations are forward-only and additive, so code can roll back without touching the schema.
- ✅ Feature flags for AI, market data and the scheduled job, all changeable without a deploy.
- ✅ Function runtime and `maxDuration` set explicitly on every AI route.
- ✅ Backup and restore documented, with the auth-schema trap called out.
- ⚠️ No backup restore has been rehearsed in this environment. [DISASTER-RECOVERY.md](DISASTER-RECOVERY.md)
  §5 says how, and why the number it produces is the only real RTO.

## Documentation

- ✅ [ARCHITECTURE.md](ARCHITECTURE.md), [API.md](API.md),
  [PRODUCTION-ARCHITECTURE.md](PRODUCTION-ARCHITECTURE.md),
  [PRODUCTION-RUNBOOK.md](PRODUCTION-RUNBOOK.md),
  [DISASTER-RECOVERY.md](DISASTER-RECOVERY.md), [PERFORMANCE.md](PERFORMANCE.md), this file.
- ✅ Domain docs: [PORTFOLIO-CALCULATIONS.md](PORTFOLIO-CALCULATIONS.md),
  [TECHNICAL-ANALYSIS.md](TECHNICAL-ANALYSIS.md), [ALERTS.md](ALERTS.md), [PWA.md](PWA.md),
  [AI.md](AI.md), [AI-ARCHITECTURE.md](AI-ARCHITECTURE.md), [AI-SECURITY.md](AI-SECURITY.md),
  [AI-PROMPTS.md](AI-PROMPTS.md).
- ✅ Legal: `/privacy`, `/terms`, `/disclaimer`, written from the code rather than a template.

---

## Before the first production deploy

1. Create the production Supabase project; apply every migration.
2. Set the environment variables in Vercel. `CRON_SECRET` is required or alerts silently never run.
3. Leave `AI_ENABLED=false` until the provider budget is decided.
4. Deploy to preview. Run `E2E_BASE_URL=… npx playwright test tests/e2e/smoke.spec.ts`.
5. Promote. Run the smoke test again against production.
6. Confirm the cron job appears in Vercel and fires within five minutes.
7. Take a `pg_dump` and confirm it restores into a scratch project. Record how long it took.
