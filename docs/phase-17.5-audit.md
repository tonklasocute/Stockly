# Phase 17.5 — Production Review, UX & Data Audit

A review of Stockly after phases 1–17, carried out by reading the code rather than the documentation
describing it. Every finding cites the file it came from; anything not verified says so.

**Scope note.** Phases 8 and 14 were themselves hardening passes, so most of what follows confirms
that work. The findings are where reality drifted from the rules the codebase sets itself — and the
most serious one is a regression **introduced by phase 16**, which is exactly what a cross-phase
audit is for.

---

## 1. What was inspected

| | Coverage |
|---|---|
| Source | ~64,800 lines across `app/`, `components/`, `domain/`, `features/`, `lib/`, `services/`, `types/` |
| Domain modules | 41, with 47 test files |
| API routes | 64 |
| Pages | 34 |
| Migrations | 15 |
| Tests | 86 files, 1,885 assertions |

Audited by direct inspection: the calculation engines and their single-source-of-truth invariants,
every route's guard and ownership path, null/zero semantics across all financial paths, the money
abstraction, provider failure handling, the service worker's cache rules, the sharing projection,
the import path, all four scheduled jobs, and the multi-market/multi-currency rules.

---

## 2. Findings

| Severity | Count | Fixed |
|---|---|---|
| **P0** | 1 | 1 |
| **P1** | 1 | 1 |
| **P2** | 3 | 3 |
| **P3** | 3 | 0 (documented) |

---

### FIN-001 — Incomplete snapshots enter return, risk and drawdown calculations

```text
ID:          FIN-001
Category:    Financial Calculation / Data Integrity
Severity:    P0
Location:    features/analytics/portfolio-analytics.ts:153, 309 (buildValuations)
             features/analytics/portfolio-analytics.ts:recordSnapshot
             features/automation/snapshots.ts:recordEndOfDaySnapshots
```

**Problem.** `ownSnapshots` filters snapshots by **currency only**. Every row then flows into
`buildValuations` → `returnIndex` → time-weighted return, money-weighted return, volatility, Sharpe,
beta and the entire drawdown history.

Since phase 16 those rows include readings Stockly explicitly cannot stand behind:

- a **`STALE`** row, written by the end-of-day job, carries *the previous day's value forward*. In
  the return series that is an interval with a return of exactly 0%.
- a **`PARTIAL`** row carries a total that excludes holdings no exchange rate reached.

**Root cause.** Phase 16 changed `recordSnapshot` from *refusing* incomplete days to *recording them
with a quality label*, to close a real gap: a hole in the history is indistinguishable from a day the
portfolio was not held. That change was right for **display** and wrong for **calculation** — and the
calculation side was never updated to exclude the new rows. The original refusal existed precisely to
protect these figures, and its own comment said so:

> "a snapshot is the only figure Stockly cannot recompute later, so a total that silently excluded a
> position would become a permanent dip in the performance chart with nothing left to explain it."

Phase 16 removed the guard and kept the consumer.

**Impact.** Financial figures that are wrong in a direction that flatters:

- Carried-forward days inject artificial zero-return intervals, which **suppress measured
  volatility** and therefore **inflate the Sharpe ratio**.
- A `PARTIAL` row produces an artificial dip and the next complete row an artificial recovery — a
  fabricated round trip that the drawdown engine reads as a real fall and risk reads as real
  volatility.
- TWR chains through both.

**Recommended fix.** Keep recording the labelled rows — that part of phase 16 is correct — but feed
**only `COMPLETE` readings** into anything that computes a return. Display keeps every row with its
quality; calculation reads only what Stockly can stand behind.

**Fixed:** yes. `buildValuations` and `performanceSeries` now receive complete rows only.

**Why it survived phase 16 — worth recording.** Writing the regression test turned up the reason
nobody noticed: **TWR is immune.** It chains sub-period returns, and a carried-forward value
contributes a factor of exactly 1.0, so the headline return figure was correct throughout. The
damage was confined to the statistics that read the *shape* of the series rather than its endpoints
— volatility, Sharpe and drawdown. `domain/snapshot-quality.test.ts` asserts both halves: that a
carried-forward reading measurably suppresses volatility and deepens the worst drawdown, and that it
leaves TWR untouched.

---

### CUR-001 — Fundamental money figures rendered without a currency

```text
ID:          CUR-001
Category:    Multi-Currency / UX
Severity:    P1
Location:    features/fundamentals/components/fundamentals-panel.tsx:131, 169
```

**Problem.** Market capitalisation, free cash flow and net debt are rendered with
`formatCompact(value)` — no currency argument — so a SET company reporting in THB shows `12.0B`
beside a US company's `4.2B`, with nothing to distinguish them.

**Root cause.** `formatCompact`'s currency parameter is optional, and phase 17 omitted it. The
statement's reporting currency was available at the call site (`statement.currency`) and unused.

**Impact.** Directly violates the rule in `CLAUDE.md`: *"Money is formatted through `lib/format.ts`
with `narrowSymbol`, so `$` and `฿` are never confused."* A ฿12B revenue read as $12B is a
thirty-two-fold error in the reader's head.

**Recommended fix.** Pass the statement's reporting currency into every money-valued tile.

**Fixed:** yes.

---

### PERF-001 — N+1 query in the end-of-day snapshot job

```text
ID:          PERF-001
Category:    Performance / Database
Severity:    P2
Location:    features/automation/snapshots.ts:recordEndOfDaySnapshots
```

**Problem.** The job loops over portfolios and issues one `select … limit 1` **per portfolio** to
find its latest snapshot. At `MAX_SNAPSHOT_PORTFOLIOS` (200) that is 200 sequential round trips over
HTTP inside a function with a 60-second budget.

**Impact.** Not incorrect, but a job that fails by timeout writes a partial day and leaves the rest
to tomorrow. It also scales with users, so it degrades exactly as the deployment grows.

**Recommended fix.** One query for the candidate rows, grouped in memory.

**Fixed:** yes — one indexed read, then a map.

---

### PERF-002 — Row-by-row upserts in the fundamentals refresh

```text
ID:          PERF-002
Category:    Performance / Database
Severity:    P2
Location:    features/automation/fundamentals-refresh.ts:102, 149
```

**Problem.** Statements and events are upserted one row at a time inside a loop that is itself inside
a loop over instruments — up to 40 × (4 statements + 2 events) = 240 sequential round trips.

**Impact.** Same shape as PERF-001: a slow job that gets slower as coverage grows.

**Recommended fix.** Batch the upserts per instrument. supabase-js accepts an array.

**Fixed:** yes.

---

### UX-001 — Two representations of "not available"

```text
ID:          UX-001
Category:    UX Consistency
Severity:    P2
Location:    lib/format.ts:109 (formatCompact), features/screener/components/screener-client.tsx (×8)
```

**Problem.** 82 places render a missing figure as **`N/A`**; `formatCompact` and the screener table
render the same meaning as an em dash **`—`**.

**Impact.** `CLAUDE.md` states missing values "render as `N/A`". An em dash is ambiguous — it reads as
a separator, a placeholder or a zero depending on the reader — where `N/A` is explicit. On the
screener it appears in a column of numbers, which is the worst place for that ambiguity.

**Recommended fix.** One representation, `N/A`, for a figure that cannot be computed.

**Fixed:** yes — with a distinction kept deliberately. Three em dashes remain, and all three mean
something else:

- the import preview shows `—` for a cell the **source file left blank**, which is a fact about the
  file rather than a failed calculation;
- the watchlist shows `—` for a **missing company name**, which is text, not a figure;
- `goal-simulator.tsx` already distinguishes `null` → `N/A` (not computable) from `0` → `—` (a
  measured gap of exactly nothing). That is the correct use of the character, and blanket-replacing
  it would have destroyed a real distinction.

---

### P3 — documented, not fixed

| ID | Finding | Why deferred |
|---|---|---|
| **CQ-001** | `domain/insights.ts:397,401` uses `?? 0` on `weightPct` where the enclosing `.filter()` has already excluded nulls. | Unreachable, not a bug — TypeScript cannot narrow through `filter`. Removing it needs a type predicate; no behaviour to fix. |
| **CQ-002** | `computeContribution` in `domain/analytics.ts` is computed on every analytics pass and rendered nowhere. | Dead compute, cheap. Deleting it is a behaviour-free change better made when something needs the slot. Note it is a *third* meaning of "contribution" in the codebase (savings contribution, P&L share, return attribution) — only the first and third reach a user, and they are labelled distinctly. |
| **UX-002** | `screener-client.tsx:427` uses `row.relativeVolume ? … : "—"` — a falsy test on a number, so a measured value of exactly 0 renders as missing. | Practically unreachable (a stock with zero volume across the window), but the pattern is wrong. Worth fixing when that file is next touched. |

---

## 3. Verified with no finding

Each of these was inspected and found correct. Listed so this is a statement about coverage, not
only about problems.

| Area | What was checked | Result |
|---|---|---|
| **Transaction source of truth** | Every path that could write a derived figure | Holds. Imports create ordinary transactions; simulations, sharing, personalization, history, attribution and fundamentals are all read-only, each with a boundary test that runs the operation and compares the financial state byte for byte. |
| **Duplicate calculations** | All money-producing modules | One implementation each. `reconstructAt` deliberately calls the *same* `replayPortfolio` rather than reimplementing it, with a test asserting reconstructing today reproduces today. |
| **Null/zero semantics** | Every `?? 0` and `\|\| 0` in the tree | 31 occurrences, all inspected. Every one is either inside a pre-filtered set, behind an explicit `> 0` guard, a sequence tie-breaker, or a form preview. **No financial metric falls back to zero.** |
| **Precision** | Accumulation points | `domain/money.ts` scaled integers throughout; no second numeric abstraction. Float-error tests in `domain/invariants.test.ts`. |
| **API guards** | All 64 routes | 59 use `guarded()`. The 5 that do not are the two unauthenticated health probes and the three cron endpoints, which use the shared-secret constant-time check. |
| **IDOR** | 24 routes accepting a `portfolioId` | All read through RLS; composite FKs to `(portfolio_id, user_id)`; no route accepts a `user_id`. Not-yours returns 404, not 403. |
| **Sharing leakage** | Public projection | `ShareSource` declares no personalization, fundamental or event field. Three independent leak tests (phases 13, 15, 17) walk the real document. |
| **PWA cache** | `public/sw.js` | Non-GET, `/api/**`, `/auth/**` and cross-origin all return early; navigations network-only. |
| **Cron security** | All four jobs | One secret, constant-time compare, unset secret rejects everything. All four idempotent by upsert key. |
| **Import** | Preview path | Writes nothing; idempotency is a partial unique index, not application code. |
| **Provider failure** | Market data, FX, fundamentals | Bounded retry on retryable errors only; every failure degrades a section and names itself; no fabricated zero anywhere. |
| **Dependencies** | `npm audit` | 0 vulnerabilities, runtime and dev. |
| **Code quality** | Whole tree | 0 TODO/FIXME/HACK. 3 `console` calls, all client-side and commented. |

---

## 4. Not measured

- **Performance before/after.** PERF-001 goes from one query per portfolio (up to 200) to two
  queries total; PERF-002 from one upsert per row (up to 240) to two per instrument. That is
  arithmetic on the query count, **not a benchmark** — no latency figures are claimed, because none
  were measured.
- **Live database behaviour.** No migration in this repository has been applied to a database in this
  environment, so RLS policies are asserted structurally rather than exercised by a second session.
  This remains the largest single gap and is unchanged from phase 14.
- **E2E.** Enumerates; needs a running app and a real database.
