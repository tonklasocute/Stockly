# Stockly — Phase 20 final production report

**Date:** 2026-09-03 · **Phase:** 20 (final) · **Verdict:** **READY WITH WARNINGS**

---

## 1. Executive summary

Stockly is complete as a product and correct as a calculation system. It is **not yet proven as a
deployment**, and the gap is narrow, specific and unchanged since phase 14: no migration in this
repository has ever been applied to a database, so 44 tables' worth of row-level security is
asserted by reading SQL rather than by a second session failing to read the first's data.

Everything that can be verified without a database has been, and passes:

| | |
|---|---|
| Tests | **2,288 passing** across 99 files |
| Lint | **0 errors**, 11 warnings (all `react-hooks/incompatible-library` from React Hook Form's `watch()`) |
| Typecheck | **clean** |
| Build | **passes**, AI off and on |
| Dependency audit | **0 vulnerabilities**, runtime |
| Scale | 1,000 holdings / 10,000 transactions through every engine in **~200 ms** |

Phase 20 added the stress engine, the cross-system financial regression suite and the scale suite,
and closed one inherited debt item. It found **no P0 issue**. It did find and fix three real defects
in phase 19, described in §3.

The verdict is `READY WITH WARNINGS` rather than `READY` because three properties are documented
but unrehearsed. They are listed in §14 with what each one would take.

---

## 2. Final architecture

The shape has not changed since phase 1, which is the most important thing this report can say.

```
Transactions  (the only writable financial record)
     ↓  replayPortfolio          ← one implementation, called by everything
Holdings · cost basis · realized P&L
     ↓  priceHoldings + FX
Portfolio value  (native and base currency, separately nullable)
     ↓
Performance (TWR/IRR) · Attribution · Risk · Drawdown
     ↓
Stress  ← simulateWhatIf, the same engine the what-if tab uses
```

Everything to the right of the first arrow is **derived on read**. There is no stored holding, no
stored P&L, no stored return, no stored contribution and no stored stress result.

| Layer | Count | Note |
|---|---:|---|
| Domain modules | 45 | Pure. No framework, database or network import anywhere in `domain/`. |
| API routes | 73 | 68 through `guarded()`; the 5 others are 2 health probes and 3 cron endpoints on a constant-time shared secret. |
| Pages | 36 | |
| Migrations | 17 | Forward-only, additive. |
| Tables | 44 | **All 44 have RLS enabled.** Verified by parsing every migration. |

### Phase 20's one architectural decision

Phase 20 was asked for a stress engine. `simulateWhatIf` — phase 11 — already restated a portfolio
under arbitrary prices, quantities and exchange rates, with base-currency translation and null
where no rate reaches.

Building a second engine beside it would have created two answers to "what is this portfolio worth
today", which is the exact failure nineteen phases have been spent avoiding. So `domain/stress.ts`
calculates no portfolio value at all. It contributes scenario *builders*, coverage accounting,
component decomposition and recovery arithmetic, and delegates every figure. A stress result and
the dashboard cannot disagree, because only one of them computes.

---

## 3. Financial integrity

### The new proof

`domain/financial-integrity.test.ts` (42 tests) walks one deterministic fixture — two markets, two
currencies, a partial sell, a re-buy, fees on both sides, a dividend, a deposit and an account fee —
through the entire chain, asserting against figures **computed by hand from the fixture**, not
against whatever the code currently returns.

Then it runs every read-only subsystem in the application against that fixture and compares the
complete derived state before and after, byte for byte: individually, all together, and twice over.

```
stress scenario · stress matrix · what-if · position reconciliation · cash reconciliation
share adjustment · attribution · drawdown history · data-quality scan · insights
```

None of them moves a number. That is now asserted in one place rather than inferred from six
separate boundary tests.

### Defects found and fixed in phase 20

| | Severity | |
|---|---|---|
| **Historical scenario sign** | Would have been P0 | `DrawdownEvent.depthPct` is a *positive* depth; a shock component is a signed move. Read straight through, the worst fall in a portfolio's history would have been applied as a rally. Caught while writing the test, fixed, and pinned by a test that exists for exactly this. |
| **O(n²) coverage scan** | P2 | Stress coverage searched the result list once per holding — a million comparisons at 1,000 holdings. Indexed. Caught by the scale suite. |
| **CQ-001 (inherited)** | P3 | `?? 0` on a pre-filtered `weightPct` in `domain/insights.ts`. Closed with a type predicate, so the narrowing is real rather than asserted. |

### Defects found in phase 19 (fixed there, recorded here)

| | Severity | |
|---|---|---|
| **`toDomain` dropped `market`** | **P0** | Every transaction reached the engine as `US`. Positions keyed `US:PTT` while quotes arrived keyed `SET:PTT`: no price was ever found, the holding fell back to cost, and it was valued in dollars. An entire market silently mispriced, with nothing thrown and nothing visibly wrong. |
| **Four capital-flow call sites** | P1 | `kind === "deposit" ? … : …` in the IRR series, TWR valuation points, historical capital flows and goal contributions — each treating any unrecognised kind as a withdrawal. Widening the enum would have made a custody fee a withdrawal in every performance figure. Now all four read `CASH_FLOW_DIRECTION`. |
| **Two mappers disagreeing on market** | P2 | `dedupeInstruments` used `(row.market as MarketId) ?? "US"`; `""` is not nullish. |

### The invariants, and where each is proven

| Invariant | Proof |
|---|---|
| Transactions are the only financial source of truth | `financial-integrity.test.ts`, plus 7 per-phase boundary tests |
| Unknown is `null`, never `0` | `holdings-currency`, `reconciliation`, `stress`, `data-quality` tests |
| A deposit is not a return | `financial-integrity.test.ts` §4; `CAPITAL_FLOW_KINDS` |
| A withdrawal is not a loss | same |
| FX movement is not stock performance | `summary.fxEffect` is typed `null`; `holdings-currency.test.ts` |
| News cannot change a figure | `news-invariants.test.ts` |
| Fundamentals cannot change a figure | `fundamentals-invariants.test.ts` |
| Stress cannot change a figure | `financial-integrity.test.ts`, `stress.test.ts` |
| Reconciliation cannot change a figure | `operations-invariants.test.ts` |
| A corporate event never becomes a transaction | `corporate-events.test.ts`, `operations-policies.test.ts` |
| Money never accumulates through raw floats | `domain/money.ts` scaled integers; `invariants.test.ts` |

---

## 4. Advanced risk & stress testing

Delivered in `domain/stress.ts` (44 unit tests) and the `Stress test` tab of the planning workspace.

| Requirement | Status |
|---|---|
| Deterministic engine | **Complete.** No clock — `calculatedAt` is an input, so two runs are equal. |
| Absolute / percentage price shock | **Complete** (`INSTRUMENT`, `UNIFORM`) |
| Market shock | **Complete.** Never applied across markets. |
| Sector shock | **Complete**, with the coverage caveat below |
| Currency shock | **Complete.** Direction stated in one constant and printed in the assumptions. Base currency never shocked; a currency with no real rate gets no override. |
| Combined shock | **Complete.** Components compound; decomposition sums exactly to the whole. |
| Historical scenario | **Complete.** From the portfolio's own deepest observed fall on the flow-adjusted index. `N/A` with too little history. |
| Coverage / exclusions | **Complete.** Three-way: shocked, correctly unaffected, excluded with a named reason. |
| Recovery arithmetic | **Complete.** `−d/(1+d)`, `null` for no loss and for total loss. |
| Scenario matrix | **Complete.** Every row a real run — cash does not fall, so scaling would misstate. |
| Waterfall | **Complete** as the component decomposition table. |
| Benchmark stress | **Degraded** — see §12. |
| Liquidity awareness | **Not supported** — see §12. |
| Saved scenarios | **Not built** — deliberate; see §13. |

**No prediction, no advice.** `STRESS_DISCLAIMER` is a fixed constant on the screen;
`FORBIDDEN_STRESS_PATTERNS` is checked by a test against every generated sentence — no "will rise",
no "expected return", no "likely to", no "recommend", no "too risky".

### Sector coverage is honest about being thin

Sector classification comes from the market-data provider's company profile. On the free tier that
is often absent, and the mock provider supplies none. A sector shock therefore reports most
holdings as **excluded — no sector classification** rather than quietly passing over them. That is
the correct behaviour and it will look sparse in a default deployment. It is a data limitation, not
a defect.

---

## 5. Security

| Control | Result |
|---|---|
| RLS enabled | **44 / 44 tables.** Verified by parsing every migration. |
| Routes through `guarded()` | 68 / 73; the 5 others are 2 unauthenticated probes and 3 cron endpoints on a constant-time secret |
| Routes accepting a `user_id` | **none** |
| Anonymous grants | **two**, both `security definer` token functions for share links. No table grant to `anon` except `published_shares where visibility = 'PUBLIC'` |
| IDOR | Every user table carries `user_id` + a composite FK to `(portfolio_id, user_id)`. The two `security definer` functions added in phase 19 check `auth.uid()` themselves, asserted by `supabase/operations-policies.test.ts` |
| Sharing leakage | 4 independent leak tests (phases 13, 15, 17, 19) walk the real projection under every preset and with every switch on at once |
| Audit trail | `financial_audit` has a select policy and **no** insert/update/delete policy — the absence is the protection |
| Dependency audit | 0 vulnerabilities |
| Secrets in logs | `lib/log.ts` redacts by field name and value shape; no bare `console` in server code except the logger itself |
| Request body cap | 64 KB (2 MB for import), checked by declared length *and* measured bytes, before `JSON.parse` |
| URL safety (news) | https only, allowlisted; `javascript:`/`data:`/`vbscript:` rejected; no proxy or redirect through Stockly's origin |
| File upload | Format from magic bytes, never filename; filename displayed and used as a path by nothing; size, row, column and cell caps; formula injection escaped on export |
| PWA cache | Non-GET, `/api/**`, `/auth/**` and cross-origin all return early; navigations network-only |

**Not done:** no penetration test, and no adversarial exercise against a running deployment. Every
finding above comes from reading code and from automated tests.

---

## 6. Performance

### Measured

`domain/scale.test.ts` — **1,000 holdings, 10,000 transactions, two markets**, through:

replay · valuation · cash · per-currency cash · a combined stress scenario with sector coverage ·
the full scenario matrix · position reconciliation · split adjustment

**~200 ms for the whole suite**, locally. The ceilings asserted in that file are at least fifty
times the observed figures, deliberately: a tight timing assertion on shared CI hardware is a flaky
test, and a flaky test in a financial suite gets ignored. They exist to catch an accidental O(n²) —
and they caught one.

The suite also asserts that **scale does not change an answer**: one instrument's position, cost
basis and realized P&L are identical alone and among a thousand others.

### By design, not measured

`docs/PERFORMANCE.md` accounts for upstream credits and database round trips per request: one
batched quote call **per market**, one FX call **per currency pair**, one `loadAnalytics` pass
shared by a page and all its sections via `cache()`. That is arithmetic on the request count, not
latency.

### Not measured at all

**Dashboard end-to-end latency.** It needs a database. See §14.

---

## 7. Data quality

One scan, on the already-cached analytics pass, so it cannot disagree with the pages it summarises
and nothing is stored. Eleven categories, each with a severity and a count — never a score.

Phase 19 added three: unresolved reconciliation findings (WARNING), a stale reconciliation
(NOTICE), never reconciled (INFO, and only for a portfolio that has transactions).

`daysSinceReconciliation` is `null` when there has never been a completed run, and null is not
zero: "never reconciled" and "reconciled today" are opposite states.

### Freshness

`domain/freshness.ts` is the single policy: four named windows, read by the quote, FX, snapshot and
data-quality paths rather than restated in each. Phase 14 found two copies drifting; there is one
now, and `DATA_QUALITY_THRESHOLDS` reads from it rather than repeating the numbers.

`fetchedAt`, `dataAsOf` and `publishedAt` are distinct fields throughout. News age is computed from
`publishedAt` — a story published yesterday and fetched a minute ago is a day old.

---

## 8. PWA / mobile

| | |
|---|---|
| Manifest, icons, theme, offline page | Present; `app/manifest.ts`, `appleWebApp` metadata for iOS |
| Service worker | Registered as `/sw.js?v=<APP_VERSION>`; update offered, never forced |
| Cache safety | Nothing authenticated is ever written to a cache. Sign-out clears query and worker caches |
| Touch targets | `pointer-coarse:` ≥44px — the new stress and reconciliation controls are all `h-11` |
| Wide content | Every new table scrolls inside `overflow-x-auto`; the page body never scrolls horizontally at 390px |
| Charts | `next/dynamic`, `ssr: false`. The stress tab adds **no chart** — its output is tables, which read better on a phone and need no textual summary |

---

## 9. Accessibility

Applied to everything phases 19–20 added:

- Tables use `<th scope="col">` / `<th scope="row">` and carry a `<caption class="sr-only">` where
  the structure is not self-evident (the scenario matrix).
- Every form control has a `<label>`, `sr-only` where the visual context supplies the meaning.
- Status text is announced: the reconcile form's parse summaries are `role="status"`.
- **Colour never carries meaning alone.** The reconciliation status pill pairs its colour with an
  icon *and* a text label; the cash ledger's direction is a `+`/`−` glyph, not a tint.
- Focus is visible on every custom control (`focus-visible:ring-2`).
- Reordering anywhere in the app is buttons, not drag — it works with a keyboard, a screen reader
  and a thumb.

**Not done:** no audit with an actual screen reader, and no automated axe run.

---

## 10. Observability

Everything server-side goes through `lib/log.ts` — structured JSON on `console`, stable dotted event
names, flat fields only (a nested value is how a whole provider payload ends up in a log line).

`guarded()` resolves the session, times the request, logs it with a request id, and maps everything
thrown onto the shared envelope. A user quotes the id; the stack trace, the Postgres message and
the provider text stay in the log.

Counters, never figures: `reconciliation.completed` carries how many positions differed, never by
how much. `transfer.applied` carries a row count, never a symbol.

Cron writes to `job_executions` — counters and a status, with `RUNNING`/`OK`/`PARTIAL`/`FAILED`
distinguished, so a job that could not finish is never an empty success.

---

## 11. Testing

| | |
|---|---|
| Test files | 99 |
| Tests | **2,288, all passing** |
| Boundary/invariant suites | 8 — intelligence, simulation, personalization, sharing, news, fundamentals, operations, and now cross-system |
| Financial regression | `domain/financial-integrity.test.ts`, 42 tests, hand-computed fixture |
| Scale | `domain/scale.test.ts`, 10 tests at 1,000 × 10,000 |
| Structural SQL | 5 policy suites parse the migrations for RLS, constraints and grants |
| Vocabulary | 4 forbidden-pattern suites (insights, technical, AI, stress) |
| E2E | Playwright specs exist. **Never executed** — needs a running app and a database |

---

## 12. Known limitations

Each is a deliberate refusal to fabricate, not an unfinished feature.

| | |
|---|---|
| **FX attribution is always `null`** | Separating currency movement from stock performance needs a rate on every past trade date. `fx_rates_daily` starts empty and fills forward; interpolating a gap is a fabricated observation. Typed `null` so it cannot be filled in by accident. |
| **Benchmark data** | Index series are not on Twelve Data's free tier. The adapter says so and the UI renders N/A. Benchmark stress is structurally present and will be N/A in a default deployment. |
| **Sector coverage** | Provider-dependent, one profile call per symbol, often absent. A sector shock reports the gap rather than covering it up. |
| **Fundamentals** | `FUNDAMENTALS_PROVIDER=none` by default. Synthetic revenue rendered as a company's accounts is the worst thing this codebase could do. |
| **News** | `NEWS_PROVIDER=none` by default. A headline attributed to a real publication that never wrote it is worse than a wrong number. |
| **Liquidity** | Not supported. No volume-based trading-capacity estimate is offered, because none can be made honestly from the data available. |
| **Time to recovery** | Never estimated. Only *observed* recovery dates are shown. |
| **Mergers, rights offerings, tender offers** | Listed for review, never applied. Each needs a cost-basis allocation ratio only the issuer publishes; an invented basis becomes indistinguishable from realized P&L. |
| **Import fingerprint after a transfer** | Contains the original portfolio id. Re-importing the same statement into the destination creates new rows. Rewriting the key would break the audit link; reconciliation surfaces the duplicates. |
| **Weighted-average cost only** | No FIFO, no tax lots. |

---

## 13. Remaining technical debt

**No P0. No P1.**

| ID | Pri | Finding |
|---|---|---|
| CQ-002 | — | **Closed as stale.** Phase 17.5 recorded `computeContribution` as dead compute. It is rendered by the analytics page; the audit entry was out of date. Verified, restored, documented. |
| UX-002 | — | **Closed as already fixed.** The falsy test on `relativeVolume` is now an explicit `=== null`. |
| TD-01 | P2 | 11 lint warnings, all `react-hooks/incompatible-library` on React Hook Form's `watch()`. Library-level; suppressing them would hide future real ones. |
| TD-02 | P2 | Company profiles are the one unbatched provider fan-out — one call per *held* symbol. Scoped to open positions and cached 24 h. A batch endpoint would fix it; the provider has none. |
| TD-03 | P3 | Saved stress scenarios were not built. `saved_simulations` stores inputs-never-results and is the right home when somebody actually wants one. |
| TD-04 | P3 | A stress scenario cannot yet be shared or exported. Deliberate — no demand, and it is the sort of thing that grows a table. |

---

## 14. Deployment readiness

### What has been verified

Lint · typecheck · unit tests · build (AI off and on) · dependency audit · RLS coverage across all
44 tables · `guarded()` coverage across all 73 routes · no route accepting a `user_id` · no
anonymous table grant beyond the one public-share select · sharing leakage under every preset ·
scale to 1,000 holdings.

### What has not — and what each would take

| Gap | Since | To close |
|---|---|---|
| **No migration has ever been applied to a database.** All 17 migrations' RLS policies are asserted by parsing SQL text, never by a second session failing to read the first's rows. **This is the single largest risk in the project.** | Phase 14 | `supabase db reset` against a local instance, then a two-session RLS exercise. A few hours. |
| **E2E never executed.** The Playwright specs enumerate but need a running app and a real database. | Phase 8 | Run `npm run test:e2e` against a staging deployment. Never production — the specs create and delete portfolios. |
| **No latency measurement.** No load test, no production baseline. Every performance statement in this repository is either request-count arithmetic or the pure-engine timing in §6. | Phase 14 | A staging deployment and a load generator. |
| **No penetration test.** | — | An adversarial exercise against a running deployment. |
| **No screen-reader audit.** | — | A pass with VoiceOver/NVDA and an axe run. |

None of these can be closed inside this repository. Stating them is the point: a checklist item is
ticked with the thing that makes it true, or left open with the reason.

---

## 15. Final status

### Release checklist

| | |
|---|---|
| Financial integrity | **PASS** — 11 invariants, each with a named proof |
| Transaction source of truth | **PASS** |
| Null / N/A semantics | **PASS** |
| Financial precision | **PASS** — scaled integers, no second numeric abstraction |
| Stress isolated from financial truth | **PASS** |
| Data freshness | **PASS** — one policy, four named windows |
| Authentication / authorization | **PASS** |
| IDOR | **PASS** (structural) |
| Public sharing | **PASS** — 4 leak suites |
| File upload / URL security | **PASS** |
| Rate limiting | **PASS** |
| Log redaction | **PASS** |
| Engine performance | **PASS** — measured at 1,000 × 10,000 |
| Application performance | **WARNING** — not measured |
| Database RLS | **WARNING** — asserted structurally, never exercised |
| E2E | **WARNING** — never run |
| Desktop / mobile / PWA / offline | **PASS** |
| Accessibility | **PASS** (manual), **WARNING** (no screen-reader audit) |
| Error / empty / loading / stale / N/A states | **PASS** |
| Observability · logging · correlation ids · health checks | **PASS** |
| Migration safety | **PASS** — forward-only, additive |
| Backup / recovery documentation | **PASS** — `docs/DISASTER-RECOVERY.md`, honest about what is not rehearsed |
| AI disabled by default | **PASS** — `AI_ENABLED=false`; both configurations build and are tested |
| No trading execution | **PASS** |
| No investment recommendation | **PASS** — 4 enforced vocabularies |
| No price prediction | **PASS** |

### Risk matrix

| Risk | Severity | Impact | Mitigation |
|---|---|---|---|
| An RLS policy is wrong in a way SQL-text assertions cannot see | **High** | Cross-user data exposure | Apply the migrations to a local database and run a two-session read test **before first deploy** |
| Dashboard is slow at scale in a real deployment | Medium | Poor UX at 1,000 holdings | Engines measured; database access is the unmeasured half. Every list endpoint is paginated and `loadAnalytics` is `cache()`d |
| A provider outage degrades several sections at once | Medium | Sections show N/A | Bounded retry, per-market isolation, fall back to cost and say so. Never fabricates a figure |
| A user reads a stress scenario as a forecast | Medium | Misplaced confidence | Fixed disclaimer, enforced vocabulary, assumptions never collapsible, coverage always stated |
| Sector data absent, so sector stress looks empty | Low | Feature appears broken | Reported as an explicit exclusion with a reason rather than silently skipped |
| Duplicate rows after transferring and re-importing | Low | Requires manual cleanup | Documented; reconciliation surfaces them |

### Recommendation

> ## READY WITH WARNINGS

Ship it, **after applying the migrations to a real database and running one two-session RLS check.**

That single step converts the only High risk in the matrix into a verified control, and it is the
one thing standing between this report and `READY`. Everything else on the warning list — E2E,
latency, penetration testing, screen readers — is worth doing and none of it blocks a first
deployment of a personal portfolio tracker.

No P0 issue remains. No P1 issue remains.

---

## What Stockly is

> A transparent portfolio intelligence system. Not a trading bot, not a financial advisor, and not
> a prediction engine.
>
> It calculates what can be calculated, clearly identifies what cannot, explains its assumptions,
> preserves financial history, and never pretends to know what it does not know.

Twenty phases, and the last one changed nothing about that.
