# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Stockly** — personal stock portfolio tracker, delivered as a Next.js web app that is also an
installable PWA (desktop, iOS, Android). Users record buy/sell transactions, and the app derives
holdings, cost basis, P&L, allocation, dividends and cash balance from them.

Markets: US stocks first, SET (Thailand) later. Multi-portfolio from day one, multi-currency later.

**Status: Phase 20 complete — final phase.** On top of phases 1–6, phase 7 added an AI research
assistant that answers questions
about your stocks, portfolio and watchlist in plain language — grounded in Stockly's own engines,
never in the model's memory — plus a natural-language screener that proposes filters for you to
review. It ships switched off (`AI_ENABLED=false`) and every other feature works unchanged without
it. Phase 8 hardened the whole system for production: a nonce-based CSP, database-enforced
portfolio ownership, rate limits on every paid upstream, request ids and structured logging, health
probes, CI, legal pages, and the runbook to operate it. Phase 9 made markets and currencies
first-class: SET alongside US, a portfolio base currency, an FX abstraction whose missing rates are
`null` rather than fabricated, market-data routing per market, and market calendars in each market's
own timezone. Phase 10 turned the tracker into an investment-intelligence platform: an investment
journal and thesis record, portfolio goals with scenario modelling, cash-flow-aware return
measurement (TWR and IRR), a risk centre, benchmark comparison, and a deterministic insights engine
that describes and never advises. Phase 11 added planning and simulation: compound growth and DCA,
goal projection with a required-contribution solver, dividend projection, and a portfolio what-if —
all pure, all client-side, and none of it able to touch a transaction. Phase 12 added data and
automation: CSV and Excel import with column mapping, a preview that writes nothing, duplicate
detection whose idempotency is a database guarantee, reconciliation against a broker statement, a
data-quality centre, and scheduled market and FX refresh with a job history — every imported row
becoming an ordinary transaction processed by the engine that was already there. Phase 13 added
sharing: a portfolio can be published as a page — private, link-only or public — with every section
and every figure switched off until its owner turns it on, plus expiring and revocable share links,
immutable snapshots, and a preview that is the real page. An anonymous visitor never reads a
portfolio; they read a projection the owner's own session produced. Phase 14 was a hardening and
observability pass rather than a feature: a full production audit, a bounded provider retry that
the documentation had claimed but the code never had, every server log routed through the
structured logger, a centralised freshness policy, `private, no-store` on every API response, and
the cross-phase invariant suite that proves only a transaction can move a number. Phase 15 made
Stockly personal: a dashboard whose widgets the user orders and hides, summary metrics they choose,
their own tags and saved views over holdings, pins, recently viewed, insight dismissal, a density
setting, a default portfolio and a command palette — none of which can move a figure.
Phase 19 made the records checkable: a broker statement can be compared against the portfolio and
every difference is *described* — with candidate causes and never a verdict — while the portfolio
itself is untouched, because a change happens only when the user approves one. It also gave the cash
ledger the kinds a statement actually contains, gave splits a representation that restates history
without rewriting a transaction, made every write to a money-bearing table auditable by a database
trigger nobody can bypass, and made a portfolio transfer what it always should have been: the same
rows, re-parented, realizing nothing.
Phase 20 closed the project: a stress engine that restates the portfolio under price, market,
sector, currency and combined assumptions — built *on* the phase 11 what-if engine rather than
beside it, so a stress figure and the dashboard can never disagree — with explicit coverage,
component decomposition, the recovery arithmetic that existed nowhere, and a historical scenario
taken from the portfolio's own worst observed fall. Alongside it: the cross-system financial
regression suite that walks transactions → holdings → P&L → cash → performance → attribution → risk
→ stress on one hand-computed fixture, a scale suite at 1,000 holdings and 10,000 transactions, and
a full production audit whose honest conclusion is recorded in
[`docs/phase-20-final-report.md`](docs/phase-20-final-report.md).
See [Development Phases](#development-phases).

## Commands

```bash
npm run dev              # dev server
npm run build            # production build
npm run lint             # eslint
npm run typecheck        # tsc --noEmit
npm test                 # vitest (unit)
npm test -- holdings     # a single test file / pattern
npm run verify           # lint + typecheck + test + build — exactly what CI runs
npm run test:e2e         # Playwright; needs E2E_EMAIL/E2E_PASSWORD and a running app
npm run test:e2e:install # once, to download the browser
npm run audit:ci         # runtime dependency audit, high and critical only
npm start                # serve the production build (PWA needs a real build, not `next dev`)
npx supabase gen types typescript --local > types/database.ts   # once a project exists
node scripts/i18n-extract.mjs app components features   # find hardcoded user-facing text
SUMMARY=1 node scripts/i18n-extract.mjs app components features   # …as a per-file count
```

Keep this section accurate — update it in the same change that adds or renames a script.

Playwright is installed (phase 8). Its specs live in `tests/e2e/` and are the only tests that need a
running application and a real database — everything else runs without either. **Never point them at
production**: they create and delete portfolio records.

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js (App Router) + React + TypeScript | Server Components by default |
| Styling | Tailwind CSS + shadcn/ui + lucide-react | shadcn components land in `components/ui/`, owned by us |
| Server state | TanStack Query | the default for anything from the network |
| Client state | Zustand | only when state is shared across unrelated trees; not a default |
| Forms | React Hook Form + Zod | one Zod schema reused by form and API route |
| Charts | Recharts | one library covers the donut and the price area chart; Lightweight Charts only earns its place when candlesticks do |
| Backend | Next.js Route Handlers | no separate service; see extraction path below |
| DB / Auth | Supabase (PostgreSQL + Auth + RLS) | RLS is the primary authorization boundary |
| Market data | Twelve Data, behind `MarketDataProvider` | free tier: 8 credits/min, 800/day, **1 credit per symbol**. Routed per market in `services/market-data/index.ts` |
| Exchange rates | `FxRateProvider` — mock, Twelve Data `/exchange_rate` | one credit per pair per 10-minute cache window; a missing rate is `null`, never a fabricated one |
| Tests | Vitest (unit). Playwright when E2E is first needed | |
| Export | Hand-written CSV writer (`lib/csv.ts`) | 20 lines, with formula-injection escaping |
| Sharing | Published jsonb projection + `security definer` token functions | no service-role key on any request path; the anonymous role's whole grant is one table where `visibility = 'PUBLIC'` |
| Import | Same file's parser + `lib/xlsx.ts` | no dependency: npm `xlsx` carries open advisories `audit:ci` would fail, ExcelJS is a tree to read four XML files |
| Push | `web-push` (VAPID) | RFC 8291 encryption is not something to hand-roll |
| News | `NewsProvider` — mock, unavailable | **`NEWS_PROVIDER=none` by default**: no configured vendor supplies news, and the mock's sources are fictional on a reserved domain so it can never name a real outlet |
| Fundamentals | `FundamentalDataProvider` — mock, unavailable | **`FUNDAMENTALS_PROVIDER=none` by default**: Twelve Data's free tier supplies no statements, so the architecture ships with no vendor and says so |
| Benchmarks | `BenchmarkProvider` — market-data adapter, mock | index series are not on Twelve Data's free tier; the adapter says so and the UI renders N/A |
| AI | `AIProvider` — Anthropic (official SDK), OpenAI-compatible (`fetch`), mock | server-side only; `AI_ENABLED=false` by default |
| Scheduling | Vercel Cron → `/api/cron/alerts` | secret-guarded; any external scheduler works too |
| Logging | `lib/log.ts` — structured JSON on `console` | Vercel captures stdout; a logging library would add a flush problem in a function that can be frozen |
| E2E | Playwright | money paths only: the critical journey and a post-deploy smoke test |
| CI | GitHub Actions | lint · typecheck · test · build (AI off *and* on) · dependency audit · secret scan |
| i18n | `next-intl`, cookie-resolved, no locale routing | Thai + English. `domain/locale.ts` is the registry; `locales/<code>/<namespace>.json` are the messages |
| Deploy | Vercel | |

**No Go microservice.** Business logic lives in `domain/` with zero framework imports so it can be
ported later if the app ever outgrows Route Handlers. Do not pre-build for that split.

## Architecture

Read `docs/ARCHITECTURE.md` before designing anything non-trivial. The decisions that matter most:

1. **Transactions are the source of truth.** Holdings, average cost and realized/unrealized P&L are
   *derived* on every request by `domain/holdings.ts`, never stored as independently mutable rows
   that can drift out of sync. `features/portfolios/portfolio-view.ts` is the only caller.
2. **Calculations live in `domain/`** — pure functions, no React, no Supabase, no `fetch`. Everything
   money-related is unit-testable without a database. UI components never compute P&L inline.
3. **Market data goes through one interface.** `services/market-data/types.ts` defines
   `MarketDataProvider`; `index.ts` picks the implementation from `MARKET_DATA_PROVIDER`. No provider
   name may appear outside that folder, and no provider payload shape may escape its adapter — every
   response is Zod-parsed into the domain model at the boundary.
   Provider calls are **server-side only**: the key is read through `lib/env.server.ts`, which imports
   `server-only`, so a client import is a build error rather than a leak.
4. **Money never accumulates through raw floats.** `domain/money.ts` sums over scaled integers;
   `sumBy` replaces `reduce((a, b) => a + b)` for anything monetary. Formulas are unchanged — only the
   accumulation points. See [`docs/PORTFOLIO-CALCULATIONS.md`](docs/PORTFOLIO-CALCULATIONS.md).
5. **Every upstream call is cached by TTL, never by component render.** `services/market-data/http.ts`
   is the single fetch, using the Next Data Cache (`next: { revalidate }`), which is shared across
   serverless instances. Quotes 60s, history 5 min–6 h, search and profiles 24 h. One batched quote
   call prices a whole portfolio.
6. **Every user-owned table carries `user_id` and has RLS enabled**, default-deny. Do not rely on
   route handlers alone to scope queries.

### Folder structure

```
app/         routes + route handlers (app/api/**). Server Components by default.
components/  shared presentational UI. components/ui/ = shadcn primitives.
features/    feature slices (portfolio/, transactions/, watchlist/, …).
             Each owns its components/, hooks/, schema.ts, api.ts. Cross-feature
             imports go through the feature's index, or the code belongs in lib/.
domain/      pure business logic. No framework imports. Heavily tested.
             locale.ts (supported languages, Intl tags — imports nothing at all) ·
             market.ts (market/currency/instrument registry, symbol identity) · fx.ts (rates,
             freshness, conversion) · calendar.ts (sessions, holidays, timezones) ·
             money.ts (precision) · holdings.ts (cost basis, P&L, base-currency translation) ·
             cash.ts · dividends.ts ·
             analytics.ts (allocation, concentration, contribution, trade + fee statistics) ·
             alerts.ts (crossing + state machine) · indicators.ts · technical.ts · screener.ts ·
             ai.ts (intent, symbol validation, safety vocabulary, data coverage) ·
             returns.ts (TWR, IRR — capital flows removed) · risk.ts (volatility, drawdown,
             Sharpe, beta, HHI) · goals.ts (progress semantics, projections) ·
             research.ts (journal, thesis, sell-review vocabulary) ·
             insights.ts (deterministic rules + INSIGHT_THRESHOLDS) ·
             simulation/ (growth + DCA, goal plan, dividend plan, what-if — pure, no I/O at all) ·
             import/ (mapping, value parsing, fingerprint, validation, reconciliation) ·
             data-quality.ts (freshness + completeness rules, no score) ·
             sharing.ts (visibility, presets, slugs, link state, the public projection) ·
             freshness.ts (one policy for how old a reading may be before it stops being current) ·
             personalization.ts (widgets, layout, metrics, saved views, tags, pins — display only) ·
             history.ts (reconstruct any past date, capital flows, periods, turnover, fee impact) ·
             attribution.ts (money-weighted contribution, price/dividend split, active return) ·
             drawdown-history.ts (peak/trough/recovery events, regime) ·
             news.ts (articles, URL safety, dedupe, categories, tone, relevance, event links) ·
             fundamentals.ts (statements, periods, margins, growth, TTM) · valuation.ts (multiples,
             yields, historical context) · corporate-events.ts (events, coverage, dividend facts) ·
             reconciliation.ts (position + cash comparison, candidate causes, run status) ·
             corporate-actions.ts (share adjustments, split arithmetic, what is not adjustable) ·
             stress.ts (scenario builders, coverage, decomposition, recovery — over simulateWhatIf)
lib/         cross-cutting infra: supabase clients, env parsing, formatting, constants.
services/    external integrations behind interfaces (market-data/, fx/, benchmark/, ai/).
types/       shared types, generated types/supabase.ts.
supabase/    migrations/, seed.sql.
locales/     th/ and en/ — one JSON per namespace, plus a static barrel per language.
scripts/     i18n-extract.mjs — finds hardcoded user-facing text. Run by a test, not just by hand.
docs/        architecture and design docs.

Unit tests live next to the source as *.test.ts. Add a tests/ folder when the first E2E spec exists.
```

Deliberately **not** top-level: `hooks/`, `utils/`, `schemas/`. Hooks and schemas belong to the feature
that owns them; generic helpers belong in `lib/`. A top-level `utils/` becomes a junk drawer.

Do not create new folders or abstractions "for later". Add them when the second real use case appears.

## Coding Rules

- TypeScript `strict: true`. No `any` — use `unknown` plus narrowing. No non-null `!` on values that
  can genuinely be null.
- Business logic never lives in a component. If a component computes a number a user could dispute,
  that computation belongs in `domain/`.
- Validate all external input (request bodies, query params, market-data responses) with Zod at the
  boundary. Trust nothing from the client, including prices and totals — recompute server-side.
- Server Components by default; `'use client'` only for interactivity, and push it as far down the
  tree as possible.
- Prefer editing an existing component over adding a near-duplicate. Check `components/` and the
  feature slice before creating anything.
- Handle errors explicitly. No empty `catch`. No swallowed promise rejections.
- Money and quantities: never accumulate through JS floats across many rows. Aggregate in SQL
  (`numeric`) or via the shared helpers in `domain/`, and format only at the edge.
- A provider field that may be missing is `null`, never `0`, all the way to the UI, where it renders
  as `N/A`. A fabricated zero in a financial figure is worse than an admitted gap.
- Symbols pass through `normalizeSymbol` before they are used as a key, a query param, or a row value.
- **No user-facing hardcoded text.** Every string a user reads goes through `t()` into a namespace,
  in Thai *and* English. That includes toasts, validation messages, empty states, chart labels,
  `aria-label`, `placeholder` and `title`. See [`docs/i18n.md`](docs/i18n.md).

## Naming Convention

```
Components        PascalCase          PortfolioSummary.tsx
Hooks             useCamelCase        useHoldings.ts
Functions/vars    camelCase
Constants         UPPER_SNAKE_CASE
Types/interfaces  PascalCase          (no I- prefix)
Files             kebab-case, except React components (PascalCase)
Database          snake_case          tables plural, columns singular
API routes        kebab-case          /api/cash-transactions
Zod schemas       xxxSchema           createTransactionSchema
```

## Market & Currency Rules

Full detail in [`docs/MULTI-MARKET.md`](docs/MULTI-MARKET.md).

- **An instrument has a market, and a market has a native currency.** `domain/market.ts` is the
  registry; everything downstream reads `instrument.market` and `currencyOf(market)`.
- **Never hardcode market behaviour by symbol.** `if (symbol === "PTT")` is forbidden, and so is
  `if (market === "TH")` outside the registry and the provider router. Adding a market is a row in
  `MARKET_REGISTRY`, a row in an adapter's `PROVIDER_MARKET`, and a `check` constraint — no domain
  function changes.
- **Currency is derived from the market, never stored beside it.** `market = 'US', currency = 'THB'`
  must not be representable. Cash and dividends are the two deliberate exceptions, because a
  portfolio really can hold two balances and a listing really can pay in another currency.
- **Portfolio valuation uses the portfolio's base currency** (`portfolios.currency`). Holdings keep
  their own: `marketValue` is native and never null, `baseMarketValue` is translated and **is**
  nullable. Never overwrite one with the other.
- **Missing FX is `null`, never 0 and never 1.** A rate of 1 values a ฿32 stock at $32; a 0 erases a
  real position from a real total. A total that excluded a holding reports `untranslatedCount` and
  the page says so.
- **Today's rate translates today's value, and nothing else.** A stored row's numbers can never move
  because a rate did. `fxEffect` is typed `null` because separating currency movement from stock
  performance needs the rate on every past trade date, and Stockly stores none — never invent it.
- **Technical analysis uses native market prices.** An RSI is a shape in a price history; converting
  the series first folds the exchange rate into the indicator. Snapshots are shared reference data
  and cannot be denominated in any one user's currency.
- **Everything per-instrument is keyed by `symbolKey`** (`"SET:PTT"`) — quotes, snapshots, alert
  readings, position weights. A bare symbol is unique only inside one market.
- **One batched quote call per market, one FX call per currency pair.** Never one per holding. A
  market whose provider fails contributes nothing and is named; the others still return.
- Market status comes from the provider; `domain/calendar.ts` fills the gap and answers `"unknown"`
  past its verified holiday horizon rather than guessing "open". Never the browser clock.
- `market` and `currency` on a request body are closed enums, validated at the boundary and again by
  a `check` constraint. A market the app cannot price must not be storable.
- Money is formatted through `lib/format.ts` with `narrowSymbol`, so `$` and `฿` are never confused.
  A headline total uses `formatCurrencyWithCode`. Never concatenate a currency symbol by hand.

## Investment Intelligence Rules

Full detail in [`docs/INTELLIGENCE.md`](docs/INTELLIGENCE.md).

- **The intelligence layer may never change a financial number.** Journals, theses, goals and
  benchmarks are notes and targets, never inputs. `domain/intelligence-boundary.test.ts` reads the
  source of every calculation module and fails if one imports them. The dependency runs one way.
- **Never store a derived figure in an intelligence table.** No realized P&L on a sell review, no
  progress on a goal, no return on a benchmark link. Every one is re-derived from `loadAnalytics` on
  each request, so it cannot go stale and cannot disagree with the dashboard.
- **Only the user sets a thesis status.** The system may put a fact beside a thesis — "the position
  is 18% below its cost basis" — and stops there. Deciding a thesis is broken is a sell
  recommendation with extra steps.
- **A sell review records why, never how much.** The result comes from the transaction.
- **A goal's type decides what progress means.** `INVESTED_CAPITAL` is cost basis, not money
  deposited; `DIVIDEND_INCOME` is a rate, not a lifetime total. A percentage target carries no
  currency and a money target must have one — enforced by the schema *and* a check constraint.
- **A deposit is not a return.** Every return figure removes external capital on both sides. TWR
  for anything compared against a benchmark; IRR when the question is what this investor earned.
- **Risk is measured on the flow-adjusted return index, never on portfolio value**, and every
  statistic has a stated minimum sample below which it returns `null`. A statistic from too few
  observations is a made-up one.
- **Projection assumptions are the user's, shown beside the result, and never a forecast.** The
  scenario growth rates are planning placeholders, not the portfolio's history — Stockly does not
  extrapolate a user's past into their future. "The month the model crosses the target" is the
  strongest sentence allowed.
- **Insights are deterministic, never a model call.** Every threshold lives in `INSIGHT_THRESHOLDS`,
  documented; no bare number in a rule. Every sentence is checked against
  `FORBIDDEN_INSIGHT_PATTERNS` by a test — no buy, sell, hold, rating, target or forecast.
- **A rule never fires on a figure that does not exist.** Every input is nullable and produces
  nothing when null. An insight built from a missing number looks like knowledge.
- **AI reads insights, never produces them.** Engine → insights → structured facts → model → prose.
  Journals and theses are never sent to the model.
- **A benchmark in another currency reports both returns and a null difference.** Translating one
  needs historical FX, which Stockly does not store.

## Planning & Simulation Rules

Full detail in [`docs/SIMULATION.md`](docs/SIMULATION.md).

- **A simulation is arithmetic on assumptions the user chose, never a prediction.** The vocabulary
  enforces it: `annualReturn` not `expectedReturn`, `scenarioPrice` not `expectedPrice`, a
  **projected gap** not "you will miss your goal". No result may say a price, a rate or a market
  will do anything.
- **A simulation may never mutate the portfolio.** `domain/simulation/` has no client, no writer, no
  network and no framework import; `invariants.test.ts` reads its source to keep it that way and
  asserts holdings, cost basis and P&L are byte-identical after every simulation runs.
- **One growth engine.** `simulateGrowth` is the only place compounding happens. Phase 10's separate
  projection was deleted rather than kept beside it.
- **The closed form and the loop must agree.** `futureValue` is inverted by the solver; the loop
  draws the chart. A test asserts they match to nine decimal places wherever both apply.
- **Contributions land at the END of each period**, stated in every assumptions panel. Escalation is
  annual, not per period. Rates are decimal fractions inside the engine and percentages on the wire,
  converted in exactly one place.
- **Every simulation returns a result or a reason code** — never `NaN`, never `Infinity`. −100% is
  modelled; below −100% is refused, because a fractional power of a negative base is not real.
- **Scenario growth rates are example assumptions, not forecasts and not the user's history.**
  Extrapolating somebody's past into their future is not something Stockly does implicitly. Defaults
  that *are* derived come from the user's own data and are `null` when there is none.
- **A saved scenario stores inputs, never results.** Everything is recomputed on open, so it cannot
  go stale and is never financial history. The what-if scratchpad is not saveable at all.
- **Actual, projected, scenario and assumption are four labels, applied consistently.** Projections
  are drawn dashed and never styled like the actual performance line; actual dividend income is
  never added to or charted beside a projected figure.
- **Every projection screen carries its assumptions and a disclaimer, neither hidden nor
  collapsible.** A projected figure read without the assumptions that produced it is indistinguishable
  from a forecast.
- **Nothing simulates on the server.** The engine is pure, so it runs in the browser as an input
  changes. The only endpoint is persistence.

## Import & Automation Rules

Full detail in [`docs/IMPORT.md`](docs/IMPORT.md).

- **An imported row is an ordinary transaction.** Import creates rows in `transactions` and nothing
  else derives from them differently. There is no second holdings system, no staging table that
  becomes authoritative, no import-specific cost basis.
- **Preview writes nothing** — no session row, no file, no staging. A user who abandons an import
  leaves nothing behind, and the side-effect test is then trivially true.
- **The uploaded file is never stored.** It is parsed in the request that received it and dropped.
  Storage would mean retention, encryption at rest, signed URLs and a deletion path, for no gain.
- **Idempotency is a database guarantee, not an application check.** The partial unique index on
  `(user_id, import_fingerprint)` is what makes re-importing the same file safe; the pre-query is an
  optimisation. A `23505` retries the batch row by row so genuinely new rows still land.
- **The fingerprint is a canonical string, never a hash.** A hash collision silently skips a real
  trade. With a broker reference the values are excluded, so a corrected row is a *conflict* to
  resolve, never a second transaction.
- **The server re-validates every row.** The posted preview is a claim about what the user saw, not
  an instruction. Mapping, normalization, validation and fingerprinting all run again before a write.
- **No silent correction.** An unparseable value is `null` and becomes a rejection with a reason —
  never a repaired guess and never `0`. An ambiguous date is refused rather than resolved by a coin
  flip.
- **Format is decided by content, never by filename.** A filename is attacker-controlled text: it is
  displayed and used for nothing else, never as a path.
- **Read values, never formulas.** The XLSX reader takes the cached `<v>` and never touches `<f>`.
  Every entry it inflates is size-capped, so a small zip cannot become a large allocation.
- **Deleting an import never deletes money.** The FK is `on delete set null`; the transactions stay.
- **Reconciliation reports and never writes.** Transactions with no fingerprint are counted
  separately, not treated as discrepancies.
- **Data quality has counts, not a score.** A single number invites optimising the number. Nothing
  is stored — the scan runs on the cached analytics pass, so it cannot disagree with the dashboard.
- **A scheduled job is bounded, secret-guarded and safe to run twice.** It skips closed markets,
  refreshes `unknown` ones, batches one call per market, and writes counters — never figures — to
  `job_executions`. An unset `CRON_SECRET` rejects everything.

## Sharing Rules

Full detail in [`docs/SHARING.md`](docs/SHARING.md).

- **An anonymous visitor never reads a portfolio.** They read a *published projection* — a jsonb
  document the owner's own session produced, already filtered by their settings. The anonymous
  role's entire grant is `select` on `published_shares where visibility = 'PUBLIC'` plus two
  token-gated `security definer` functions. There is no service-role key on any request path.
- **A shared page is a publication, not a live feed**, and it says so. It prints when it was
  published and offers no sentence that implies a current price. A snapshot is labelled harder still.
- **`projectPublicPortfolio` is the privacy boundary and the only way out.** It constructs its
  output field by field, never spreads an input, and is fed a narrow `ShareSource` — so it cannot
  leak a journal entry, a thesis, a goal note or a transaction, because it is never handed one.
- **A withheld section is absent, not null.** `null` means "not computable" and renders `N/A`; the
  key simply not being there means the owner did not share it. Never conflate the two.
- **Every switch defaults to false, and no preset turns on realised P&L, cash or search indexing.**
  A preset called "everything" is exactly where an unnoticed default does its damage.
- **A token is a capability: 32 CSPRNG bytes, stored only as SHA-256, shown once.** Never a uuid,
  never derived from an id or a timestamp, never logged, never recoverable.
- **Expiry and revocation are checked in the same statement that reads the row**, and token pages
  are `revalidate = 0`. A revoked link that survives a cache has not been revoked.
- **Every failure to open a shared page is the same failure.** Private, revoked, expired, deleted
  and never-existed are one sentence — distinguishing them answers a question only a prober asks.
- **A snapshot is immutable**: no update policy on the table, and a version so an old one stays
  readable. It is a rendering held still, never a source of truth.
- **Saving republishes, and a failed rebuild deletes the published row.** The dangerous case is an
  owner switching a section off, the save succeeding and the rebuild failing — sharing fails closed.
- **Indexing is opt-in twice** (PUBLIC *and* `allow_search_indexing`), enforced by a check
  constraint in both tables. `/share/` and `/snapshot/` are `noindex` and disallowed in robots.txt.
- **Viewer analytics is a counter and a timestamp.** No address, no user agent, no referrer, no
  geography. The audit trail records what the owner did, never who looked.
- **Deleting anything in the sharing layer deletes a page, never money.** No sharing table
  references `transactions` at all.
- **The preview is the real page** — same projection, same component. A separately-rendered preview
  can be wrong about what a stranger sees.

## Analytics Rules

- Every formula is specified in [`docs/PORTFOLIO-CALCULATIONS.md`](docs/PORTFOLIO-CALCULATIONS.md).
  Changing a number on screen means changing that file, the domain function and its test together.
- **A capital flow is not a return.** Deposits and withdrawals change the balance without changing
  performance; anything that measures performance subtracts invested capital on both sides.
- **Two yields, two names.** "Yield on current value" and "yield on cost" share a numerator and
  nothing else. Never label either one just "dividend yield".
- Metrics that cannot be computed honestly return `null` and render `N/A` — win rate with no sells,
  average hold time with no closed position, today's change with no previous close. Never 0.
- Provider metadata that is missing becomes "Unknown" and stays in the total. Never drop a holding
  from a chart.
- Portfolio insights describe, never advise. "Technology is 61% of your portfolio" — not "reduce your
  technology exposure".
- Colour never carries meaning alone: every gain or loss also shows its sign and its percentage.
- One aggregation per request. `loadAnalytics` is `cache()`d so a page and all its sections share one
  database pass and one batched quote call.
- Any write that changes portfolio numbers calls `invalidatePortfolio()` from `lib/cache.ts`. Do not
  scatter `revalidatePath`.
- Lists that grow without bound (transactions, dividends, cash) are paginated server-side. The
  calculation engine still reads the full history — a portfolio computed from one page would be wrong.

## Technical Analysis Rules

Full detail in [`docs/TECHNICAL-ANALYSIS.md`](docs/TECHNICAL-ANALYSIS.md).

- **Stockly describes, it never predicts.** No signal, score or label may imply an action. The signal
  vocabulary contains no buy, sell, target or guarantee, and a test enforces that.
- Indicators return an array **the same length as the input**, `null` for the warm-up. Crossing
  detection compares adjacent indices across series; dropping warm-up values breaks the alignment.
- `null` is "not computable", never 0. A stock with too little history has no RSI — it does not have
  an RSI of 0, and it is excluded from a screen rather than counted as extreme.
- Every threshold is a named constant in `THRESHOLDS`. No bare numeric literal in a scoring rule.
- The technical score is scored **out of the components that could be computed**, and every component
  carries the sentence that produced it. `SCORE_VERSION` is stored so an old score stays readable.
- **Screener filters are closed enums — metric, operator, value.** Never an expression, never a
  string the server interprets. Adding a metric means adding it to the enum and the lookup table.
- Screens run against cached snapshots and cost **zero upstream requests**. Never compute indicators
  per stock inside a request that a user can repeat.
- A snapshot older than 90 minutes is labelled delayed. Never present a cached indicator beside a
  live price without saying which is which.
- Technical alerts reuse the phase 5 engine. There is one alert engine; a new condition is a new
  reading, not a new evaluator.

## AI Rules

Full detail in [`docs/AI.md`](docs/AI.md), [`docs/AI-ARCHITECTURE.md`](docs/AI-ARCHITECTURE.md),
[`docs/AI-SECURITY.md`](docs/AI-SECURITY.md) and [`docs/AI-PROMPTS.md`](docs/AI-PROMPTS.md).

- **The model writes prose; it never produces a number.** The response schema has five text fields
  and no numeric one. Every figure on screen is retrieved from Stockly's engines and rendered from a
  structured payload beside the text. Never add a numeric field to that schema.
- **AI is an interpretation layer, never a source of truth.** Prices come from
  `services/market-data`, indicators from `technical_snapshots`, the score breakdown from
  `scoreTechnicals`, portfolio figures from `loadAnalytics`, pass/fail from `matchesFilter`. If the
  assistant and the dashboard could disagree about a number, the retrieval is wrong.
- **Stockly AI describes; it never advises and never predicts.** No buy, sell, hold, rating, price
  target, forecast or guarantee. Stated in the system prompt *and* enforced by `FORBIDDEN_PATTERNS`
  after generation — a prompt is a request, a check is a guarantee. A non-compliant reply is
  rewritten once, then the text is withheld and the data is published on its own.
- **A missing reading is `null` and renders as "unavailable", all the way into the prompt.** A model
  handed `RSI: 0` will describe a stock as maximally oversold and be right to.
- **The model gets no tools.** Retrieval finishes before it is called. It cannot query, fetch or
  execute anything, which is why a prompt injection cannot reach another user's data.
- **Model output is untrusted input.** Zod-validate it, repair once, then reject. Render it only as
  React text nodes — no markdown parser, no sanitiser, no `dangerouslySetInnerHTML` in `features/ai`.
- **The user's words are never part of the system prompt.** `AIMessage` has no `system` role.
- **Intent detection is a rule, not a model call.** Routing decides what to retrieve, and retrieval
  must be deterministic. Only what the intent needs is retrieved — an RSI question loads no portfolio.
- **Every prompt lives in `features/ai/prompts.ts`.** Never assemble one in a route handler.
- **Natural language becomes a proposal, never an execution.** The screener translator returns
  `{ metric, operator, value }` through the same closed enums a hand-built screen uses; the user
  reviews them and the existing `/api/screener` runs them. AI never creates an alert.
- **The daily limit is counted in `ai_usage`, not in memory**, and fails closed. The in-memory
  limiter is a per-minute brake, nothing more.
- **`AI_ENABLED=false` must leave every other feature working**, and both configurations must build.
- Log what happened, never what was said: no prompt, no answer, no key, no portfolio figure.

## Alert Rules

Full detail in [`docs/ALERTS.md`](docs/ALERTS.md).

- **Rule, event and notification are three tables and three concepts.** Never collapse them.
- **An alert fires on a crossing, never on a comparison.** `current > target` alone notifies on every
  poll. The `armed → triggered` transition in `domain/alerts.ts` is the only thing that produces an
  event; returning to `armed` requires the condition to go false.
- Daily change and total return are separate alert types. "Gain %" is ambiguous and is never used.
- Percentage change is measured against the **previous close**, fixed and documented.
- A missing reading is `null` — a symbol with no quote is not a symbol at zero, and a symbol that is
  not held has no weight rather than a weight of 0%.
- A quote older than 15 minutes never triggers anything. A provider outage triggers nothing at all.
- **One batched quote call per run, for the union of every alert's symbol.** Never a fetch per alert.
- Evaluation is server-side. A `setInterval` in a tab is not an alert system.
- The cron endpoint rejects every request when `CRON_SECRET` is unset. Never treat an unset secret as
  open access.
- The service-role key is used in exactly one place — the scheduled job — and nowhere reachable from
  a request.
- Alert conditions are enums. Never accept a client-supplied expression.
- **Push payloads never contain portfolio figures.** Prices are public and are named; value, return
  and weight say "open Stockly to see". A lock screen is not a private surface.
- Push 404/410 deletes the subscription. Any other failure is left alone. There is no retry queue.
- In-app is written first and always; push is best-effort on top.

## Market Data Rules

- Add a provider by writing an adapter next to `twelve-data-provider.ts`, declaring the markets it
  covers, and adding one `case` to `create()`. Nothing outside `services/market-data/` changes.
- Never call a provider from a client component or from a loop over holdings. Batch through
  `getQuotesFor(instruments)`, once, on the server: it groups by market and makes **one call per
  market**. `getMarketDataProvider(market).getQuotes(symbols, market)` is the single-market form.
- A provider is never asked for a market it does not declare. Answering a SET symbol from a US
  endpoint yields a plausible price in the wrong currency, which is worse than no price at all.
- Every method resolves or throws `MarketDataError`. A missing symbol is `null` or `[]`, not an error;
  a rate limit or an outage is an error. Route handlers turn those into the shared envelope with a
  `MARKET_DATA_*` code, and the raw provider text is logged, never returned.
- Market data must never take a page down: `loadPortfolioView` falls back to cost, flags the holdings
  `stale`, and the page says so.
- Do not infer market status from the browser clock. Ask the provider; `domain/calendar.ts` fills
  the gap in the market's own timezone and says "unknown" rather than guessing.
- Client polling is opt-in per component, only while the market is open, and never in a background tab.

## API Rules

- Route handlers: parse with Zod → resolve the authenticated user → query through Supabase (RLS
  applies) → return. Never accept a `user_id` from the request body.
- Response shape: `{ data: T }` on success, `{ error: { code, message, details? } }` on failure.
  Status codes: 400 validation, 401 unauthenticated, 403 forbidden, 404 missing, 409 conflict, 500 else.
- Never leak Postgres or provider error text to the client; log it server-side, return a stable `code`.
- Rate-limit anything that hits a paid upstream (market data, search) or sends notifications.

## Database Rules

- Every schema change is a migration file in `supabase/migrations/` — no changes made only in the
  Supabase dashboard.
- Migrations are forward-only and never edited after being applied to a shared environment.
- Required on user data: `user_id` FK to `auth.users`, RLS enabled, explicit select/insert/update/delete
  policies. New table without RLS = incomplete.
- Foreign keys with deliberate `on delete` behaviour; indexes on every FK and on the columns actually
  filtered/sorted; `check` constraints for invariants (quantity > 0, price >= 0, enum-like text).
- Monetary/quantity columns use `numeric`, never `float8`.

## Security Rules

Never:
- expose an API key or service-role key to the client (only `NEXT_PUBLIC_*` is client-visible);
- hardcode a secret, or commit `.env*` (only `.env.example` is tracked);
- trust a client-supplied total, price, P&L, or `user_id`;
- write a query whose isolation depends solely on application code;
- store passwords or roll custom auth — Supabase Auth owns credentials.

Always: parse `process.env` once through `lib/env.ts` and fail fast at startup on anything missing.

## Testing Rules

- `domain/` calculations: unit tests are mandatory, including the awkward cases — partial sells, sells
  that empty a position, fees, re-buys after a full exit, zero-quantity, dividend on a closed position.
- Route handlers: integration tests covering validation failure, unauthenticated access, and
  cross-user access (user A must not read user B).
- E2E (Playwright): the money paths only — sign in, record a buy, record a sell, see the dashboard update.
- Do not test shadcn primitives or Next.js itself.

## PWA Rules

Full detail in [`docs/PWA.md`](docs/PWA.md).

- **Nothing authenticated is ever written to a cache.** The service worker does not intercept
  `/api/**`, `/auth/**`, non-GET requests, other origins, or any navigation response. Adding a cache
  rule that touches user data is the one change that needs a second opinion.
- Navigations are network-only with `/offline` as the fallback. Quotes and history are cached on the
  **server** by TTL, where the cache is not tied to a device that may have several users.
- Sign-out clears the query cache and every service-worker cache before ending the session.
- The worker is registered as `/sw.js?v=<APP_VERSION>` from `lib/version.ts` — bump that one constant
  to invalidate caches. Never hardcode a version inside `sw.js`.
- An update is offered, never forced: a reload mid-form loses the user's input.
- Manifest via `app/manifest.ts`. iOS ignores it, so `appleWebApp` metadata and `apple-touch-icon`
  carry the iOS install path; Safari has no install API, so iOS gets instructions, not a fake button.
- **Touch targets use `pointer-coarse:`, not a width breakpoint.** A 768px iPad is a touch device and
  a 640px desktop window is not. ≥44px whenever the pointer is coarse.
- Dialogs are bottom sheets on touch-sized screens, centred from `sm` up.
- Mobile-first: bottom tab bar (four items), tables become cards below `lg`, no horizontal page
  scroll at 390px. Light and dark mode are both first-class.
- Charts load through `next/dynamic` with `ssr: false`. The login page must never pull the chart
  library.
- Every PWA capability degrades: no service worker, blocked storage or no install event costs a
  feature and nothing else.

## News Rules

Full detail in [`docs/NEWS.md`](docs/NEWS.md).

- **News is context, never financial truth.** An article's numbers are sentences somebody else
  wrote; none reaches a calculation. `domain/news.ts` cannot receive a portfolio, and a test ingests
  a thousand articles and asserts every figure is byte-identical.
- **A fabricated headline is worse than a fabricated number.** A wrong number is wrong; a headline
  attributed to a real publication that never wrote it is a false statement about a named
  organisation. Hence `NEWS_PROVIDER=none` by default and a mock whose sources are fictional on a
  reserved domain.
- **A provider returns articles; the domain classifies them.** Category, tone, dedupe key and
  relevance are all derived here, so no provider can smuggle in a sentiment Stockly did not compute.
- **Nothing unverifiable is shown.** No real title, no named source, no safe https link or a future
  date means the article is **dropped, not repaired**.
- **https only, allowlisted.** `javascript:`, `data:` and `vbscript:` execute on click; a URL with
  credentials is a phishing shape. Stockly never proxies or redirects through its own origin, so
  there is no open-redirect surface.
- **The dedupe key is the primary key.** Canonical URL first, never the title alone — the same
  outlet's "Market wrap" every morning would collapse into one row. The earliest publication wins.
- **Age is computed from `publishedAt`, never `fetchedAt`.** A story published yesterday and fetched
  a minute ago is a day old.
- **Tone describes prose, never direction.** Two signals one way and none the other before a label
  is claimed; `UNKNOWN` is the default and the common answer. `Positive → Buy` is forbidden, and no
  rule keys on recommendation vocabulary.
- **Relevance is a sum of named weights**, and recency is capped below ownership: a week-old story
  about a holding outranks a fresh headline about a stranger.
- **An event stays the source of truth.** A link states a confidence and never changes the event; a
  relationship that cannot be defended is not shown.
- **A feed is a description of a portfolio.** `news_articles` grants nothing to `anon` and
  `ShareSource` has no news field — a shared page carrying "your" news would leak the holdings the
  sharing switches exist to control.
- **News notifications are opt-in**, unlike every other category: an alert is something the user
  created, and news is not.

## Fundamental & Corporate Event Rules

Full detail in [`docs/FUNDAMENTALS.md`](docs/FUNDAMENTALS.md).

- **Fundamental data is reference data about a company; a portfolio is a fact about a user.** Neither
  table has a `user_id`, neither references `transactions`, and the domain engines have no way to
  receive a portfolio — the separation is in the signature.
- **An event is a notice and never becomes a transaction.** A dividend event says the company
  declared a payment; the dividend the user received is a row they recorded, and only that row
  reaches the cash engine. A test ingests a hundred events and asserts cash does not move.
- **A provider declares its own capabilities**, so "not configured" and "this company reports
  nothing" are different sentences. `FUNDAMENTALS_PROVIDER` defaults to `none`, never `mock` —
  synthetic revenue rendered as a company's accounts is the worst thing this codebase could do.
- **Every ratio goes through one function**, and a zero denominator returns `null`, never `Infinity`.
  A company with no revenue has no margin, not an infinite one.
- **Negative figures are legitimate.** A loss, negative free cash flow and negative equity are real;
  no check constraint rejects them. Plausibility is flagged by the data-quality scan, never refused.
- **Growth from a non-positive base is `null`.** A percentage change from a loss is not defined in
  any way a reader interprets correctly.
- **A period is part of a figure.** A quarter is never compared against a year, and every multiple
  carries its period — "P/E (TTM)", never a bare "P/E".
- **TTM is all four quarters or nothing**, derived on read and never stored. Flows are summed; the
  balance sheet and share count are taken from the latest quarter, because they are levels.
- **A loss-making company has no P/E**, not a negative one — otherwise "P/E < 10" matches every
  loss-making company in the market. The earnings *yield* is still reported.
- **Forward multiples have no field at all.** Not null — nowhere to put one.
- **An unknown fundamental excludes a stock from both sides of a screener comparison.** Including it
  would put unscreened companies in a screened list.
- **Fundamentals never reach a shared page.** `ShareSource` declares no field for them, and the
  events response carries a relation, never a position size.
- **Valuation describes and never judges.** "Below its median" is a fact about two numbers;
  "undervalued" is a conclusion Stockly cannot support.

## Historical & Attribution Rules

Full detail in [`docs/performance-attribution.md`](docs/performance-attribution.md),
[`docs/fx-attribution.md`](docs/fx-attribution.md) and
[`docs/historical-rebuild.md`](docs/historical-rebuild.md).

- **Reconstruction is a filter plus the existing engine, never a second one.** `reconstructAt`
  hands the transactions up to a date to the same `replayPortfolio` and `computeCash` the dashboard
  calls. A test asserts reconstructing today reproduces today exactly — if those diverge, a second
  engine has been introduced.
- **Everything derived is derived on read.** No stored return, contribution, drawdown or monthly
  figure. Correcting a transaction from March corrects March.
- **A snapshot stores only what cannot be recomputed** — the value on a day. Quantities, cost basis,
  realised P&L and cash are exact from transactions whenever they are asked for.
- **An incomplete day is recorded with its quality, never refused.** A hole in the history is
  indistinguishable from a day the portfolio was not held; a `PARTIAL` row carries a value *and* the
  count of what is missing, and a check constraint makes the two agree.
- **Contribution is money-weighted and says so.** `weight × return` is wrong the moment somebody
  trades mid-period. The engine reports `basis`, and no screen labels a figure just "return".
- **The residual is displayed, never distributed.** A gap between the parts and the whole is
  evidence that something was not captured; scaling the parts to hide it destroys the evidence.
- **Contribution is not the holding's return**, and both are shown — a position up 40% that was 2%
  of the portfolio contributed under a point.
- **Price and dividend components are slices of the total, not additions to it.** Adding them
  alongside the total double-counts.
- **FX attribution is always `null`**, typed so. It needs a rate for every day of the period;
  `fx_rates_daily` starts empty and fills forward, and interpolating a gap is a fabricated
  observation rather than a recovered one.
- **Drawdowns are measured on the flow-adjusted return index, never on portfolio value**, so a
  deposit cannot look like a recovery. Recovery means regaining the old peak, not merely rising, and
  an unrecovered drawdown is reported as ongoing — never with a projected recovery date.
- **Regimes are arithmetic states of one portfolio's index**, deliberately not "bull" or "bear".
- **A value change is not a return.** It includes money paid in, and is labelled separately wherever
  both appear.
- **The snapshot job is calendar-aware and idempotent**: the market's own trading date, upserted on
  `(portfolio_id, snapshot_date)`, refusing a date whose calendar is unverified.
- **Never rebuild a transaction.** Everything else is a view of them.

## Personalization Rules

Full detail in [`docs/personalization.md`](docs/personalization.md).

- **A preference decides what is displayed. It can never decide what is calculated.** Delete every
  preference, tag and saved view and every figure is byte-identical;
  `domain/personalization-boundary.test.ts` asserts it and reads the module's source to keep it
  free of anything that could reach a database or a network.
- **`domain/personalization.ts` imports nothing at all.** A preference is an id, a position and a
  boolean. The day it needs an import is the day to ask whether a figure is creeping in.
- **Four tables, not eight.** Five per-user documents that are read together, written together and
  never queried by their contents are columns on one row, each capped by a check constraint. Only
  what is genuinely queried and joined — tags and saved views — gets a table.
- **A tag is keyed by `(portfolio, market, symbol)`, never by a holding id.** A holding is derived
  from transactions, not stored; giving one an id in order to label it is the first step to a
  second source of truth.
- **An empty stored layout means the default, never an empty dashboard.** Reset writes `[]` rather
  than a copy of the default, which would freeze the user at whatever that default was that day.
- **A stored layout is reconciled against the registry on read *and* on write.** A widget added
  since it was saved is appended in its default visibility, never switched on at the top.
- **Reordering is buttons.** "Move up" works with a keyboard, a screen reader and a thumb; drag is
  an enhancement that would have to be duplicated for all three anyway, so it is not built.
- **A metric points at a figure the engine already produced.** Adding one means finding the field,
  never writing a formula — and its name says which number it is. No "Profit", no bare "Return",
  no bare "Yield".
- **A saved view is a closed triple, never an expression**, and it stores no figure, so it cannot
  go stale. A null excludes a row from every numeric comparison in both directions, and sorts last
  in both directions.
- **`Ungrouped` always exists and comes last.** A sector is never inferred from a symbol.
- **Dismissal stores a rule code, never a rendered sentence**, and the insights that explain why a
  figure is wrong cannot be dismissed at all.
- **Nothing personal reaches a shared page.** `ShareSource` declares no personalization field, and
  `features/personalization/privacy.test.ts` proves it by projection and by reading the source.
- **Preferences are read per request under RLS, never from a module-level cache** — a `Map` on a
  serverless instance is shared between whoever it serves.

## Internationalization Rules

Full detail in [`docs/i18n.md`](docs/i18n.md).

- **A locale decides what a number is called. It can never decide what the number is.** Delete every
  translation and every figure is byte-identical; `domain/locale-boundary.test.ts` asserts it, runs
  every locale operation against the engines, and reads `domain/locale.ts` to keep it importing
  nothing at all.
- **No user-facing string is written inline.** Every one goes through `t()` into a namespace, in
  **both** languages. `lib/i18n/completeness.test.ts` fails on a key present in one language and
  missing in the other — in both directions — on an empty translation, on a placeholder that
  survives one language and not the other, and on a Thai file that is a copy of the English one.
- **A namespace is a feature slice**, plus six cross-cutting ones. No decision to make: a string
  owned by `features/transactions` goes in `transactions.json`.
- **Money, quantity and percentage formatters take no locale, and must not start.** `Intl` produces
  byte-identical output for both languages — Thai uses Latin digits, comma grouping and a decimal
  point — so a locale parameter would change nothing while creating several hundred places a future
  change could make a figure differ between languages. Dates are the one exception, and take a
  `Locale` **required**, so the compiler finds every call site.
- **Thai dates are Gregorian.** `th-TH` alone resolves to the Buddhist era, and one transaction must
  not read 2569 in Thai and 2026 in English. The era is pinned once, in `LOCALE_META.th.intlTag`.
- **Language is not currency and is not timezone.** `Language: ไทย, Currency: USD` works, and so
  does the reverse. Never derive one from another.
- **An enum is never rendered raw.** ``tEnum(`cashFlow.${kind}`)`` — the domain keeps the value,
  the `enums` namespace keeps the words.
- **The server sends a code; the client chooses the words.** Two vocabularies in
  `lib/api-codes.ts`: `ERROR_CODES` is the status contract, `ERROR_DETAILS` is the *reason* when a
  status alone does not say it — `new ApiError("CONFLICT", "…", "duplicatePortfolioName")`.
  `useErrorMessage()` renders the detail, then the code, and the server's English `message` only
  when a newer server sends a detail this client has never heard of. Never render `error.message`
  to a user directly.
- **A domain module returns facts, never a sentence.** `describeAlert`, `describeEvent`,
  `describeContribution` and `newsNotificationText` all report *what happened* — a code, a
  direction, a symbol — and the ICU message decides how to say it. A sentence has grammar, and
  grammar is the one thing a pure module cannot have two of: no amount of interpolation into an
  English skeleton produces the Thai one.
- **A label in a module-level table is a key, not a word.** `NAV_ITEMS`, `TYPE_GROUPS`, `SORT_KEYS`,
  `FIELDS` — module scope has no translator, so the table holds the key and the render site
  resolves it.
- **A public page's language comes from `?lang=`, never from the owner's cookie.** The owner is not
  the one reading it. `PublicPortfolioView` takes `locale` as a prop and cannot resolve it itself.
- **Nothing a user wrote is translated**, and neither is provider content. A headline attributed to a
  real publication in words it never wrote is worse than a wrong number. The chrome around it is
  translated; the article is not.
- **A locale must never change machine-readable output** — API schemas, CSV export headers, database
  values, enum codes on the wire.
- **The locale cookie is validated against the closed enum on every read.** A hand-edited cookie or a
  crafted `?lang=` can only produce the default language, and neither value is ever echoed into the
  page. No translation is rendered through `dangerouslySetInnerHTML`.
- **A hook or a server helper, never both.** `useAppLocale()` inside a client tree, `await
  appLocale()` in a Server Component, and a `locale` **prop** for a component rendered from both —
  which the build catches, loudly, rather than the reviewer.
- **`?lang=` reaches the root layout through the middleware, on the three shared routes only.**
  `<html lang>` and the client message payload are decided in the root layout, which cannot see a
  route's search parameters — so `acceptsLocaleParam` and `LOCALE_HEADER` carry the answer there. A
  document that declares one language and renders another reads English prose in a Thai voice.
- **No new hardcoded user-facing string.** `lib/i18n/no-hardcoded-text.test.ts` runs the extractor
  over the whole tree and names the file and the sentence. Its allowlist is the complete list of
  deliberate exceptions; adding to it needs an argument, not a commit.

## Reconciliation & Operations Rules

Full detail in [`docs/reconciliation.md`](docs/reconciliation.md).

- **External data verifies the portfolio; it never replaces its source of truth.** The chain is
  external data → reconciliation → difference → human review → explicit adjustment → engine. The
  arrow from a statement straight to a figure does not exist anywhere in the code.
- **A comparison has no way to write.** `domain/reconciliation.ts` and `domain/corporate-actions.ts`
  import no client, no `fetch`, no framework and no `server-only`, and a test reads their source to
  keep it that way. `domain/operations-invariants.test.ts` runs the whole layer and asserts every
  figure is byte-identical afterwards.
- **A difference is never a verdict about who is wrong.** Every finding carries *candidate causes*
  and stops. `SPLIT_RATIO` fires only on a clean ratio — 1.37× is a different number, not a split.
- **A missing side is `null`, never `0`.** A position the statement omits, an unreported average
  cost and an absent balance are all unknown; a zero is a claim about a real quantity.
- **Cash reconciles one currency at a time, and nothing is converted.** A statement reports a dollar
  balance and a baht balance, never a translated total — comparing against `analytics.cash` would
  report today's FX rate as a discrepancy. There is deliberately no combined difference figure.
- **A cash kind's direction and meaning live in `domain/cash.ts` and nowhere else.**
  `CASH_FLOW_DIRECTION` and `CAPITAL_FLOW_KINDS` are the single statement of both. Never write
  `kind === "deposit" ? … : …` — that pattern is how a fee becomes a withdrawal in the IRR series.
- **A capital flow is not an outcome.** Deposits, withdrawals, transfers and adjustments cross the
  boundary and are removed from performance; fees, tax and interest happened *to* the portfolio and
  are part of it.
- **A split restates history; it never rewrites a transaction.** `applyShareAdjustments` is a filter
  in front of `replayPortfolio`. Quantity × ratio, price ÷ ratio, **fee untouched** — a commission
  was paid in cash once. Deleting the adjustment row restores every figure exactly.
- **A fraction left by a reverse split is kept and named, never rounded away.** Rounding it deletes
  shares the user owns; the cash in lieu is a transaction they record.
- **Only splits are adjustable.** A merger, rights offering or tender offer needs a cost-basis
  allocation ratio only the issuer publishes. An invented basis flows into realized P&L and becomes
  indistinguishable from a figure that was earned — so those are listed with a reason and recorded
  by hand.
- **A transfer re-parents transactions.** One `update … set portfolio_id`, moving an instrument's
  whole history or none of it. A synthesised sell-and-buy pair would book a profit nobody made.
- **The audit trail is written by a trigger and editable by nobody.** `financial_audit` has a select
  policy and no insert, update or delete policy — the absence of those three *is* the protection.
  It stores the row before and after, not a diff.
- **`security definer` turns RLS off, so `user_id = auth.uid()` inside those functions is the
  ownership boundary.** `correct_transaction` and `transfer_instrument` each carry it, and
  `supabase/operations-policies.test.ts` asserts they still do.
- **A financial change carries a reason** — required by the schema and by the function. A correction
  gets its own endpoint because PostgREST sends each request as its own transaction, so a reason set
  separately would never reach the trigger.
- **A failure is recorded as one.** A run is written `PROCESSING` before the comparison, `FAILED`
  requires an `error` by check constraint, and `COMPLETED_WITH_WARNINGS` exists so a run that found
  differences is never reported as clean.
- **Nothing here reaches a shared page.** `ShareSource` declares no field for a reconciliation, an
  audit row, an adjustment or a per-currency balance, and `features/operations/privacy.test.ts`
  proves it by projection and by reading the source.

## Stress Testing Rules

Full detail in [`docs/STRESS-TESTING.md`](docs/STRESS-TESTING.md).

- **There is no second valuation engine.** Every stress figure comes from `simulateWhatIf`;
  `domain/stress.ts` builds adjustments, accounts for coverage, decomposes components and does the
  recovery arithmetic, and calculates no portfolio value itself. A stress result and the dashboard
  cannot disagree about what the portfolio is worth, because only one of them computes it.
- **A scenario is arithmetic on assumptions somebody chose, never a forecast.** `STRESS_DISCLAIMER`
  is a fixed constant on the screen and `FORBIDDEN_STRESS_PATTERNS` is checked by a test against
  every sentence the module generates. The disclaimer sits outside the checked text on purpose —
  the patterns are blunt, and a disclaimer that must say "forecast" would weaken them.
- **The module has no clock.** `calculatedAt` is passed in, which is what makes a run reproducible
  and lets a test assert two runs are equal.
- **Components compound; they never replace.** A holding caught by two assumptions carries both.
  The order is part of the answer and the assumptions panel says so — with compounding assumptions
  there is no order-free attribution, and inventing one would be a made-up allocation.
- **Coverage is three-way: shocked, unaffected, excluded.** A Thai holding in a US shock is
  *unaffected* — the scenario working, not a gap. Only a missing sector or a missing FX rate is an
  exclusion, and each is named.
- **A currency move is not a price move.** A positive currency component means one unit of that
  currency buys more of the base currency; no instrument's own price changes. The base currency is
  never shocked, and a currency with no real rate gets no override — a scenario cannot invent a rate.
- **Recovery is "the gain needed to return to the starting value", never an expected recovery and
  never a duration.** `null` when nothing was lost and when everything was lost; both render N/A.
- **Every matrix row is a real run.** Cash does not fall and untranslated holdings are in no total,
  so the relationship is not proportional and scaling one row would misstate the others.
- **A historical scenario uses only what was observed**, from the flow-adjusted index, and says so
  with its dates. `depthPct` is a positive depth and a component is a signed move — the negation is
  pinned by a test, because reading it straight through applies the worst fall as a rally.
- **Nothing is stored and there is no endpoint.** The tab runs in the browser because the engine is
  pure, so there is nowhere for a stress figure to become a financial record.

## Observability Rules

Full detail in [`docs/observability.md`](docs/observability.md). Audit findings in
[`docs/production-audit.md`](docs/production-audit.md), controls in
[`docs/security-checklist.md`](docs/security-checklist.md).

- **No bare `console` in server code.** Everything goes through `lib/log.ts` with a stable dotted
  event name. The three that remain are client-side, where structured JSON reaches nobody and the
  server has already logged the failure against its request id.
- **Never spread a thrown value into a log.** Use `describeError()`: a Postgres error's `details`
  and `hint` quote the values of the conflicting row. And never `String(error)` — supabase-js throws
  a plain object, so that yields `[object Object]` in the branch that matters most.
- **A log field is flat.** `LogFields` accepts no nested object, deliberately: a nested value is how
  a whole provider payload or a database row ends up in a log line by accident.
- **A push endpoint is logged as an origin, never in full.** The full URL is a bearer capability.
- **How old a reading may be is decided in `domain/freshness.ts` and nowhere else.** Four named
  policies. A copied threshold with a comment claiming it matches another one is how they drift —
  that is exactly what phase 14 found and fixed.
- **Retryability rides on the error, not on its code.** A 401 and a 502 are both "unavailable" to a
  caller; only one is worth asking again. Two attempts, never more — an unbounded retry on a 429 is
  how a rate limit becomes an outage of your own making.
- **Every API response carries `private, no-store`.** Every endpoint here is authenticated and
  user-specific, and one header removes the question of whether that is still true.
- **A doc that claims a reliability property must be checked against the code.** Two of this
  phase's findings were guarantees that were written down and never implemented.

## Production Rules

Full detail in [`docs/PRODUCTION-CHECKLIST.md`](docs/PRODUCTION-CHECKLIST.md),
[`docs/PRODUCTION-RUNBOOK.md`](docs/PRODUCTION-RUNBOOK.md),
[`docs/PRODUCTION-ARCHITECTURE.md`](docs/PRODUCTION-ARCHITECTURE.md) and
[`docs/DISASTER-RECOVERY.md`](docs/DISASTER-RECOVERY.md).

- **Isolation is the database's job, never a handler's.** A child row carries `user_id` *and* a
  composite foreign key to `(portfolio_id, user_id)`. If a rule can be a constraint, it is one.
- **Every route goes through `guarded()`.** It resolves the session, times the request, logs it, and
  maps everything thrown onto the shared envelope with a request id. No route handler catches its
  own errors into a bespoke response.
- **Never return a stack trace, a Postgres message or a provider's text.** Log it against the
  request id and return a stable code. The id is the only thing a user needs to quote.
- **Rate-limit anything that spends money**, and remember which limiter is which: the in-memory one
  is a brake on loops, the database-counted one is the ceiling. A spending cap fails closed.
- **Every external call has a timeout and a bounded retry.** Retry a rate limit, a timeout and a
  transient outage; never a bad key or an unusable response.
- **Third parties degrade, they do not cascade.** A market-data outage falls back to cost basis and
  says so; AI failing costs the assistant alone. Readiness probes Postgres and nothing else.
- **The CSP is nonce-based, so every route that renders a script must be server-rendered.** A
  statically prerendered page has no nonce, and its scripts are blocked in production only. Adding
  `export const dynamic = "force-dynamic"` is the fix; the smoke test asserts it.
- **Log what happened, never what was said.** No password, token, key, prompt, answer or portfolio
  figure. `lib/log.ts` redacts by field name and by value shape; the call sites are the real
  guarantee.
- **Migrations are forward-only and additive**, so code can always roll back without touching the
  schema. A destructive change needs a two-step deploy.
- **Every list endpoint is paginated**, and the calculation engine never reads a page — a portfolio
  derived from one page would be wrong.
- **Request bodies are capped** (64 KB) before `JSON.parse`, by declared length and by measured
  bytes. App Router handlers have no default limit.
- **Anything that can be turned off without a deploy, should be**: `AI_ENABLED`,
  `MARKET_DATA_PROVIDER=mock`, an unset `CRON_SECRET`, `CSP_MODE`.
- **A checklist item is ticked with the thing that makes it true, or left open with the reason.**
  Never tick a box because it sounds done.

## Git Convention

Conventional Commits: `<type>(<scope>): <description>` — `feat`, `fix`, `refactor`, `docs`, `test`,
`chore`, `style`, `perf`, `build`, `ci`. Scope is the feature or area (`portfolio`, `pwa`, `auth`, `db`).

**Claude must never run `git commit` or `git push` unless the user asks in that message.** Finish the
work, run the checks, summarize the diff, and propose a commit message for the user to run themselves.

Before proposing one: `git status`, `git diff`, scan the change set for secrets, then
`npm run verify`. A commit message proposed without those four is a guess.

## Development Workflow

Before starting any feature: read this file → check `docs/ARCHITECTURE.md` → look for an existing
component, hook, domain function or service to reuse → plan → implement → `npm run verify` → report
results and propose a commit message.

Anything that touches a route handler, a migration or the middleware is also a production change:
re-read the relevant section of `docs/PRODUCTION-CHECKLIST.md` and update it in the same edit if the
change makes one of its statements untrue.

Prefer the smallest change that fully works. No speculative abstractions, no scaffolding "for later".

## Development Phases

| Phase | Scope |
|---|---|
| 0 ✅ | Foundation: CLAUDE.md, architecture doc, folder structure, `.env.example` |
| 1 ✅ | MVP: auth, portfolios, transactions, derived holdings, dashboard, P&L |
| 2 ✅ | Market data: symbol search, quotes, historical prices, charts, watchlist |
| 3 ✅ | Analytics: allocation, performance, dividends, cash, realized/unrealized breakdown |
| 4 ✅ | PWA: service worker, offline shell, install flows, mobile/touch pass |
| 5 ✅ | Alerts: price, percentage, portfolio and position alerts; notification centre; Web Push |
| 6 ✅ | Technical analysis: indicators, technical score, screener, technical alerts |
| 7 ✅ | AI: provider abstraction, grounded research assistant, natural-language screener, usage and cost controls |
| 8 ✅ | Production hardening: security headers, ownership constraints, rate limits, observability, health probes, CI, E2E, legal pages, runbook |
| 9 ✅ | Multi-market foundation: market/instrument registry, portfolio base currency, FX abstraction and caching, provider routing, SET support, market calendars, cross-currency valuation |
| 10 ✅ | Investment intelligence: journal, theses, sell reviews, goals and projections, TWR/IRR, risk centre, benchmarks, deterministic insights engine |
| 11 ✅ | Planning & simulation: compound growth and DCA, goal projection and required contribution, dividend projection, portfolio what-if, saved scenarios |
| 12 ✅ | Data & automation: CSV/Excel import, mapping, duplicate detection, reconciliation, data-quality centre, scheduled refresh and job history |
| 13 ✅ | Sharing & ecosystem: visibility model, per-section privacy controls, public pages, expiring and revocable share links, immutable snapshots, share presets, preview |
| 14 ✅ | Production hardening & observability: production audit, provider retry, structured logging everywhere, centralised freshness policy, cache headers, security checklist, incident severity, cross-phase invariants |
| 15 ✅ | Personalization: user preferences, customizable dashboard widgets, chosen summary metrics, tags and holding groups, saved views, pins and recently viewed, insight dismissal, density, command palette and shortcuts |
| 16 ✅ | Data intelligence & attribution: historical reconstruction, money-weighted attribution with residual, drawdown history, monthly performance, turnover and fee impact, snapshot quality and versioning, EOD snapshot job, FX rate table |
| 17 ✅ | Fundamental intelligence: provider abstraction with declared capabilities, normalized statements, metrics and valuation engines, corporate events, fundamental screener filters, portfolio event awareness |
| 17.5 ✅ | Production review: audit report, phase-16 snapshot regression fixed, currency on fundamental figures, two N+1 jobs, one representation of N/A |
| 18 ✅ | News & market context: provider abstraction, normalization and de-duplication, URL safety, deterministic categories, tone and relevance, corporate-event linking, feeds for portfolio/watchlist/market, opt-in notifications |
| 19 ✅ | Advanced portfolio operations: position and cash reconciliation with run history, the full cash ledger, split adjustments applied in front of the engine, a trigger-written audit trail, corrections that carry a reason, and portfolio transfer by re-parenting |
| 20 ✅ | Advanced risk & stress testing over the existing what-if engine, coverage and exclusions, component decomposition, recovery arithmetic, historical scenario, cross-system financial regression suite, scale suite, full production audit and final report |

| 21 ✅ | **Bilingual.** Thai + English throughout: locale registry, cookie-resolved locale with a stored per-user preference, language switcher, namespaced translations, enum/error/validation vocabulary, Gregorian-pinned Thai dates, localized metadata and PWA manifest, `?lang=` on public pages, completeness, hardcoded-text, resolution, persistence and financial-invariant suites, plus a bilingual E2E walk of every page |

Anything beyond this — Monte Carlo, per-instrument price history and full FX
attribution, FIFO cost basis, tax lots — is a new project against a finished one, not a phase 21.

Do not start the next phase without being asked.

## Reference

UX/functionality inspiration only: https://saph-set.pages.dev/ — do not copy its source, assets,
branding, or reproduce its design pixel-for-pixel. Stockly's UI is our own.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
