# Fundamentals & Corporate Events (Phase 17)

Company financials, valuation multiples and corporate events — what is computed, what is refused,
and the one architectural fact that shapes the whole phase.

---

## 1. The fact that shapes everything

**Stockly's configured market-data vendor supplies no fundamentals.** Twelve Data's free tier — the
tier this application is built and rate-limited against — includes quotes, candles and profiles, and
does not include financial statements, corporate events or an earnings calendar.

So phase 17 ships the *architecture* with no vendor behind it. `FUNDAMENTALS_PROVIDER` defaults to
**`none`**, and the default provider declares zero capabilities and returns nothing.

The two alternatives were both worse:

- **A "Twelve Data" adapter returning empty arrays.** Then the UI cannot distinguish "this company
  reports nothing" from "we have no provider", and every instrument looks like a company with no
  accounts.
- **Falling back to the mock in production.** Synthetic revenue rendered as a company's accounts is
  the single worst thing this codebase could do, and no amount of labelling makes it safe.

Hence `capabilities` is part of the provider contract, and every fundamentals surface reads it
before rendering an empty state. "Not configured" and "no data" are different sentences.

```
FUNDAMENTALS_PROVIDER=none   ← default. Says so in the UI.
FUNDAMENTALS_PROVIDER=mock   ← deterministic synthetic data, development only.
```

The mock's figures are deliberately small and round rather than plausible billions, so a mock
statement rendered by mistake reads as a mistake.

---

## 2. Separation from the portfolio

> **Fundamental data is reference data about a company. A portfolio is a fact about a user.**

Neither `financial_statements` nor `corporate_events` has a `user_id`. Neither references
`transactions`. The domain engines take a symbol and a market and have **no way to receive a
portfolio** — the separation is in the signature, not in a convention.

The temptation this phase creates is specific and worth naming: a dividend *event* looks so much
like a dividend *received* that turning one into the other is a plausible refactor. It must never
happen. An event says the company declared a payment; the dividend the user received is a row they
recorded, and only that row reaches the cash engine.
`domain/fundamentals-invariants.test.ts` ingests a hundred dividend events and asserts the cash
balance does not move by a cent.

---

## 3. Null semantics

Every metric divides one reported figure by another, and **every one of them returns `null` when it
cannot be computed honestly**. `ratio()` is the single place that decides:

- a missing numerator or denominator → `null`
- a **zero denominator** → `null`, never `Infinity`. A company with no revenue does not have an
  infinite margin; it has no margin.
- a non-finite input → `null`

A `null` renders **N/A**, and the tile says which input was missing rather than leaving a blank.

### Negative values are legitimate

A loss is real. Negative free cash flow is a company investing. Negative equity happens. The
migration deliberately has **no** `check (net_income >= 0)` — rejecting those would discard true
reports. Plausibility belongs in the data-quality scan, which flags rather than refuses.

### Growth from a negative base is refused

`growth(5, −10)` returns `null`, not `+150%`. A percentage change from a loss is not defined in any
way a reader interprets correctly, and printing a number there is worse than printing nothing.

---

## 4. Periods are part of a figure

A quarter is not a year. `comparablePeriods` refuses to compare across period types, so a Q1 revenue
measured against a full year cannot produce a −75% "decline" that is an artefact of the calendar.

Every valuation multiple carries its period, and every label says it: **"P/E (TTM)"**, never a bare
"P/E". `METRIC_LABELS.PE_RATIO` contains "TTM" and a test asserts it.

### TTM: all four quarters or nothing

`computeTTM` requires exactly four consecutive quarters in one currency. Three annualised is a
fabrication. Two details that are easy to get wrong:

- **Flows are summed; the balance sheet is not.** A balance sheet is a snapshot at a moment, and
  adding four of them produces a number that means nothing — the latest quarter's is used.
- **Share count is a level, not a flow.** Also taken from the latest quarter.

TTM is derived on read and **never stored**: a stored TTM could disagree with the quarters it came
from.

---

## 5. Valuation

| Computed | Refused |
|---|---|
| P/E, P/S, P/B, P/FCF, EV/EBITDA, EV/Sales | Any multiple with a non-positive denominator |
| Earnings yield, FCF yield, dividend yield | **Forward multiples of any kind** |
| Market cap, enterprise value | EV when debt or cash is missing |

**A loss-making company has no P/E**, not a negative one. A negative P/E would let a screen for
"P/E < 10" match every loss-making company in the market. The earnings *yield* is still reported,
because −4% is a true and readable statement where −14× is not.

**Forward multiples do not exist as a field.** Not "null when unavailable" — there is nowhere to put
one. That is the strongest available guarantee that a forward estimate is never invented, and
`capabilities.forwardEstimates` is false even for the mock.

**Enterprise value is null unless market cap, debt and cash are all present.** A partial EV
overstates the figure and a reader cannot tell.

### Currency mismatch

A company reporting in one currency while its shares trade in another produces multiples that are
mostly an exchange rate. Translating needs the rate on the statement's period end, which Stockly
does not store (see `docs/fx-attribution.md`), so `computeValuation` reports the mismatch and
computes nothing.

### Historical context

A "5-year median P/E" needs at least `MIN_VALUATION_HISTORY` (8) observations. Below that it is
`null` — three readings are not a median of anything.

The wording matters more than the arithmetic:

> "Current P/E is 27% below its median of 20.5 over 10 periods."

is a fact about two numbers. **"The stock is undervalued"** is a conclusion requiring knowledge of
*why* the multiple moved, which Stockly does not have. Every sentence this layer produces is checked
against `FORBIDDEN_INSIGHT_PATTERNS` — the same list the insights engine is held to.

---

## 6. Corporate events

An event is a **notice**, never a transaction.

- **A date can be estimated, and says so every time it appears.** An estimated earnings date
  presented as confirmed is the most misleading thing a calendar can do, because a reader plans
  around it.
- **A dateless event is `UNKNOWN`, not `UPCOMING`.** "We do not know when" and "it has not happened
  yet" are different statements, and only one belongs on a calendar.
- **De-duplication prefers a confirmation over an estimate.** Providers re-send an event as its date
  firms up; a later fetch must never downgrade a confirmed date back to an estimate. The database's
  identity index keys on the month rather than the exact date, so a re-dated event updates in place.
- **Market coverage is declared.** `MARKET_EVENT_COVERAGE` says which types each market supplies —
  SET does not consistently publish earnings dates — so an uncovered type is reported as uncovered
  rather than as "no events".

### Portfolio event awareness

`relevantEvents` returns only instruments the user **holds or watches**, held ranked above watched.
A calendar of every listed company is a news feed, and this is not one.

The events are public; **that this user holds AAPL is not**. The join happens on the server under
the user's own session, and the response carries a `relation` of HELD or WATCHED with no quantity,
value or cost — enough to explain why a row is there, nothing about the size behind it.

---

## 7. Screener

Fundamental metrics live in the **same** `SCREENER_METRICS` enum, not a second screener. A user
filtering "RSI < 30 and P/E < 20" is asking one question.

**An unknown fundamental excludes a stock from both sides of a comparison.** A stock Stockly knows
nothing about matches neither "net margin > 20" nor "net margin < 20" — including it would put
unscreened companies in a screened list, which is worse than a shorter list.

Crossing operators are not offered for fundamentals: "P/E crossed above 20" has no series to cross.

---

## 8. Freshness

Fundamentals use the **snapshot** policy from `domain/freshness.ts` (90 minutes), not the quote
policy (15). A company reports quarterly; a statement fetched an hour ago is not stale in any sense
that matters, and applying the quote threshold would label every fundamental figure delayed.

Every bundle carries `source`, `fetchedAt` and a freshness state, and the UI prints them.

---

## 9. Automation

Fundamentals refresh rides on `/api/cron/data` rather than taking a fourth endpoint and a fourth
schedule — they change quarterly, so a daily refresh is already generous, and folding them in keeps
one secret and one history row. It runs after the quotes and cannot fail them.

- **Idempotent.** Statements upsert on `(market, symbol, period_type, fiscal_year, fiscal_quarter)`;
  events on their identity index. A second run rewrites the same rows.
- **Bounded.** `MAX_REFRESH_INSTRUMENTS` (40) per run, drawn from what users hold and watch.
- **Shared.** One fetch of AAPL's statements serves everybody who holds it — which is precisely why
  the tables have no `user_id`.
- **Creates nothing a user owns**, and never a transaction.

---

## 10. Security and privacy

| Concern | What answers it |
|---|---|
| Endpoint abuse | Both routes are authenticated and rate-limited. The data is public; the ability to make Stockly *fetch* it is not. |
| IDOR | Neither route accepts a portfolio id it does not read through RLS. `/api/fundamentals` accepts none at all. |
| Sharing leakage | `ShareSource` declares no fundamental or event field, and `features/fundamentals/privacy.test.ts` proves it by projection and by reading the source. |
| Ownership disclosure | The events response carries a relation, never a position size. |
| Provider credentials | Read through `lib/env.server.ts`, which imports `server-only`. |
| Untrusted provider input | Bounded by check constraints at the database boundary — symbol length, title length, detail ≤ 500 chars, non-negative dividend amounts. |
| Logging | Failures log a code via `describeError`, never the provider's response body. |

---

## 11. What is deliberately not built

- **No fundamental score.** A single number would need defensible weights, and any weighting of
  margins against leverage against growth encodes an investment philosophy. The metrics are shown
  individually with their formulas instead — §10 of the brief permits a score only if the
  methodology is defensible, and no defensible one was available.
- **No forward estimates, and no field for one.**
- **No Brinson-style benchmark attribution** — see `docs/performance-attribution.md` §8.
- **No stock comparison screen.** The engine supports it (periods are comparable or explicitly not),
  but the UI was not built this phase.
- **No fundamental alerts or notifications.** The event model and the alert engine both exist; the
  wiring between them was not built.
- **No earnings-quality signals.** The inputs are present in the metrics; the deterministic rules
  were not written.
