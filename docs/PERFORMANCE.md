# Performance

Measured numbers, a budget, and the honest list of what has not been measured.

Everything below was measured on this machine (Apple Silicon, Node 22.20, production build) on
2 September 2026. **Runtime page numbers are not here**, because they cannot be produced without a
populated database and a deployed environment — see §6.

---

## 1. Client bundle — measured

Production build, uncompressed bytes of the `<script src>` set each page requests:

| Page | Scripts | Uncompressed JS |
|---|---|---|
| `/privacy` (baseline shell) | 13 | **680 KB** |
| `/offline` | 14 | 682 KB |
| `/login` | 18 | **1,346 KB** |

Total static output: 2,313 KB of JS across 51 chunks, 81 KB of CSS. Most of that is per-route and
never requested together.

**The baseline of ~680 KB** is React 19, the Next 16 App Router runtime, TanStack Query, Base UI
primitives and the app shell. Roughly 210 KB over the wire after Brotli.

**`/login` costs 666 KB more than the baseline**, and it is the first page every user sees. Measured
breakdown of the extra:

| Chunk | Size | Contains |
|---|---|---|
| — | 341 KB | Zod + `@hookform/resolvers` |
| — | 246 KB | `@supabase/supabase-js` — including `RealtimeClient`, `PostgrestClient`, storage and functions clients, **none of which this app uses in the browser** |
| — | 22 KB | the form itself |

### The lever, and why it was not pulled

Sign-in and sign-up are the only browser code that touches Supabase. Moving them to a server action
or a route handler using the request-scoped server client would remove `@supabase/supabase-js` from
the browser entirely — about 246 KB, a fifth of the login page.

It was **not** done in phase 8. Rewriting the authentication flow without the ability to exercise it
against a real auth server is how a hardening pass produces an outage on the one page that cannot
afford one. It is the single best-value optimisation available and it belongs in a change that can
be tested end to end against a live Supabase project, not bolted onto a documentation pass.

Zod is harder to justify removing: hand-written validation on the login form would break the rule
that one schema serves the form and the API route, which is worth more than 340 KB on one page.

### Already verified

- **The chart library is not on the login page.** Recharts is behind `next/dynamic` with
  `ssr: false`; a build-time check confirms no chart code appears in any chunk `/login` requests.
  This is asserted rather than assumed because it is easy to regress by adding one import.
- Charts, the AI panel and the screener load their own chunks on demand.
- `next/font` self-hosts both fonts at build time, so there is no font CDN round trip and no
  external `connect-src` for fonts.

---

## 2. Server-side engines — measured

From `domain/screener-perf.test.ts` and the unit suite:

| Operation | Measurement |
|---|---|
| Filter + sort 10,000 technical snapshots | **~2.2 s** first run (cold JIT), well under 1 s warm |
| Scaling, 100 → 1,000 snapshots | Linear, not quadratic (asserted) |
| `analyze()` — a full indicator set over 260 daily bars | **< 10 ms** |
| Whole unit suite (516 tests, 29 files) | ~5 s |
| E2E smoke suite, desktop + mobile, against a production build | ~6 s |

The screener's real universe is 60 symbols. Ten thousand is three orders of magnitude of headroom,
which is why the universe cap is a provider constraint and not a performance one.

---

## 3. Request cost — by design, not measured

What each page costs in *upstream* requests, which is the scarce resource (8 credits/minute):

Since phase 9, "1 batched quote" means **one per market the portfolio touches** — a US-only portfolio
is unchanged; one holding a Thai stock too costs two. FX is a separate, much cheaper axis: one
request **per currency pair per 10 minutes**, for the whole deployment, and none at all for a
single-currency portfolio (the identity conversion consults no provider).

| Page | Database | Market data | FX | Notes |
|---|---|---|---|---|
| Dashboard | 2 reads | **1 batched quote per market** | ≤1 per pair / 10 min | One call prices each market's half of the portfolio. |
| Portfolio | 2 reads | 1 batched quote per market | shared with the above | Deduplicated by `cache()` within a render and by the Next Data Cache within 60 s. |
| Analytics | 5 reads | 1 batched quote per market + **1 profile per held symbol** | shared | The only unbatched fan-out. See §4. |
| Stock detail | 2 reads | 1 quote + 1 profile + 1 history, then indicators client-side | 0 | One market: the one in the URL. Indicators come from the snapshot cache when fresh. |
| Screener | 1 read | **0**, then 1 batched quote per market for the 25 rows shown | 0 | A screen costs no upstream requests however often it is run, and is currency-independent. |
| Watchlist | 2 reads | 1 batched quote per market | 0 | Prices shown natively; indicators from the cache. |
| AI question | 1–4 reads | 0–2 history calls | shared | Only what the detected intent needs is retrieved. |
| Cron run | ~5 reads | 12 history + 1 batched quote per market + 1 status per market | ≤1 per pair per distinct base currency | Budgeted to fit the function timeout and the rate limit. |
| Settings | 1 read | 1 status per market | 1 per pair | The Data health panel; both degrade to "unavailable" rather than failing the page. |
| Planning | 3 reads | shared with the dashboard | shared | **Zero per interaction**: the simulation engine is pure and runs in the browser, so moving a slider costs no request at all. |

---

### Shared pages (phase 13, by design)

| Request | Upstream credits | Database round trips |
|---|---|---|
| `GET /p/<slug>` | **0** | 1 — one indexed row, `cache()`d so the page and its metadata share it |
| `GET /share/<token>` | **0** | 1 — one `security definer` call that resolves, validates and counts the access together |
| `GET /snapshot/<token>` | **0** | 1 |
| `PUT /api/shares` · `POST /api/shares/publish` | one batched quote call per market + one FX call per pair | an analytics pass plus one upsert |

This asymmetry is the whole reason a shared page is a publication rather than a live view. A link
posted to social media brings traffic that is unrelated to how many people have accounts, and a
public page that ran the engine per request would turn one popular portfolio into an outage and a
provider bill. Publishing moves that cost to a moment the owner chooses, once.

The document itself is capped at 256 KB by a check constraint, holdings at 50 and the performance
series at 400 points — so a page stays a page whatever the portfolio behind it looks like.

### Import requests (phase 12, by design)

| Request | Upstream credits | Database round trips |
|---|---|---|
| `POST /api/imports/preview` | 0 | 1 — every existing fingerprint for the portfolio, in one query, never one per row |
| `POST /api/imports` | 0 | 1 read + `ceil(rows / 200)` batched inserts + 1 session + 1 problem-rows insert |
| `GET /api/data-quality` | 0 | shares the dashboard's cached `loadIntelligence` pass; adds an import-row count and one job-history read |
| `GET|POST /api/cron/data` | one batched quote call per **open** market + one per active FX pair | 1 job-history write |

Parsing is the cost that scales, and it is bounded rather than measured: 2 MB of bytes, 5000 rows,
60 columns. A 5000-row CSV parses in a few tens of milliseconds; an XLSX of the same size costs the
inflate as well. Both sit well inside the 60 s function limit, and neither holds anything after the
response.

The scheduled refresh skips closed markets entirely, so a weekday run outside both sessions spends
nothing at all.

## 4. What was fixed in phase 8

**Company profiles were fetched for every symbol ever traded**, not for symbols currently held.
`loadAnalytics` derived its symbol list from the transaction history, so a user who had traded 200
tickers over the years and held 12 made 200 unbatched profile requests to populate a sector chart
that only ever shows the 12. Now scoped to `holdings`.

Effect on a portfolio with 12 open positions out of 200 traded: **200 → 12 upstream requests**, once
per 24-hour cache window. On the free tier that is the difference between the analytics page
rate-limiting itself on first load and not.

No other N+1 was found. Quotes, technical snapshots and watchlist reads are all batched; the alert
job already makes one batched quote call for the union of every alert's symbol.

Phase 9 kept it that way. The obvious mistake — a rate lookup per holding — is prevented by shape
rather than by discipline: `loadFxTable(base, currencies)` takes the *set* of currencies a portfolio
holds, so ten holdings in two currencies is one request no matter how the caller loops.

---

## 5. Budget

Numbers to notice being crossed, not laws:

| Budget | Limit | Current |
|---|---|---|
| Baseline shell JS (uncompressed) | 750 KB | 680 KB ✅ |
| Any single page JS (uncompressed) | 1,500 KB | 1,346 KB (`/login`) ⚠️ |
| Upstream requests per page render | 2 batched calls per market | ✅ except analytics — see §3 |
| FX requests per page render | ≤1 per currency pair, 10-minute cache | ✅ never per holding |
| Unbatched provider calls per request | ≤ number of *held* symbols | ✅ since §4 |
| AI context | 24,000 chars (~6k tokens) | enforced in code |
| AI history | 6 turns | enforced in code |
| Request body | 64 KB | enforced in code |
| Unit suite | 30 s | ~5 s ✅ |
| Production build | 3 min | ~4 s ✅ |

`/login` is the one at amber, and §1 says why.

---

## 6. Not measured — and why

Honest gaps rather than invented numbers:

- **Core Web Vitals (LCP, INP, CLS, TTFB).** These need a deployed environment with real data and
  real network conditions. Measure with Vercel Speed Insights or a Lighthouse run against the
  production URL after launch, and record the numbers here. **Do not paste a synthetic score into
  this file.**
- **Real page load times.** Every page that matters is server-rendered from a populated database.
  Without one, any figure would be measuring an empty state.
- **Load testing.** No load test has been run. `tests/e2e/` is correctness, not throughput. For a
  personal tracker the meaningful load question is not concurrent users but the provider's 8
  credits per minute, which is a hard external ceiling no amount of tuning moves. If load testing
  is done later: **never against production**, and expect the market-data provider to be the
  bottleneck long before Vercel or Postgres are.
- **Mobile device measurement.** The layout is verified at phone width by the E2E mobile project
  (no horizontal overflow, bottom navigation present). Actual device timings are not measured.

---

## 7. How to re-measure

```bash
npm run build

# Per-page JS: sum the <script src> set the page requests.
npm start &
node -e '
  const html = await (await fetch("http://localhost:3000/login")).text()
  const srcs = [...html.matchAll(/<script[^>]+src="(\/_next\/static\/[^"]+)"/g)].map(m => m[1])
  let bytes = 0
  for (const s of new Set(srcs)) bytes += (await (await fetch("http://localhost:3000"+s)).arrayBuffer()).byteLength
  console.log(srcs.length, "scripts,", (bytes/1024).toFixed(0), "KB")
' --input-type=module

# Engine throughput.
npx vitest run domain/screener-perf.test.ts
```

Record what changed and when. A performance document with no dates is a performance document nobody
trusts.
