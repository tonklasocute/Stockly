# Investment intelligence (phase 10)

Phases 1–9 answered *what* a portfolio is worth. Phase 10 adds the questions a calculation cannot
answer on its own: **why do I own this, is my reasoning still good, am I getting anywhere, and how
would I know if something were wrong.**

Two constraints shape everything below, and they are worth stating before any of the machinery:

1. **Nothing here may change a financial number.** Journals, theses, goals and benchmarks are notes
   and targets. A test reads the source of every calculation module and fails if one starts
   importing the intelligence layer — see `domain/intelligence-boundary.test.ts`.
2. **Describe, never advise.** The insights engine produces prose that sits beside somebody's money.
   Every sentence it can emit is checked against `FORBIDDEN_INSIGHT_PATTERNS`, and so is every
   observation shown beside a thesis. A prompt is a request; a check is a guarantee.

---

## 1. The user's own record

### Investment journal

One table, `investment_journals`, for every kind of note — including the sell review.

A separate `sell_reviews` table was the obvious alternative and was rejected: a sell review *is* a
journal entry — dated, attached to an instrument, holding the reasoning — that happens to carry a
structured reason as well. Splitting it would have produced two timelines to merge on every page
that shows one. `reason` is therefore nullable, and a check constraint makes it legal only on a
`SELL_REASON` entry, so the shape cannot drift.

`content` is stored and rendered as **plain text**: a React text node, never markdown, never HTML,
never through a sanitiser. There is nothing to sanitise if it can never become markup — the same
rule the AI layer follows for model output, for the same reason.

### Investment thesis

`investment_theses` holds why a position was bought, what was expected, what the catalysts and risks
were, and — the field that makes a thesis reviewable rather than a diary entry — **what would change
the user's mind**, decided in advance.

**Only the user sets the status.** Nothing on the server derives it and no job changes it. Stockly
may put a fact beside a thesis:

> The position is 18.4% below its cost basis.

and it stops there. It will never say a thesis looks broken, because a system that concluded that
would be issuing a sell recommendation with extra steps. `thesisObservations` in `domain/research.ts`
produces those sentences, and the same forbidden-vocabulary check that guards the insights engine
guards them.

One open thesis per instrument, enforced by a partial unique index on the non-`CLOSED` statuses — so
closing one and writing a new one keeps both, and the old reasoning survives.

### Sell review

A review records **why**, never how much. Realised profit and loss is computed by `domain/holdings.ts`
from the transaction that closed the position; a user-entered figure beside it would be a second
source of truth for the number this entire application exists to get right.

---

## 2. Goals

`portfolio_goals` stores a type, a target and optionally a date. **Progress is never stored** — it is
derived on every request from `loadAnalytics`, so a goal reads exactly the figures the dashboard
does and can never go stale.

The type decides what progress *means*, which is why it is an enum and not a label:

| Type | Reads | Unit |
|---|---|---|
| `PORTFOLIO_VALUE` | holdings at market value plus cash | money |
| `INVESTED_CAPITAL` | cost basis of open positions, fees included | money |
| `DIVIDEND_INCOME` | net dividends in the last twelve months — a **rate**, not a lifetime total | money/year |
| `TOTAL_RETURN` | unrealised return on invested value, the same definition portfolio alerts use | percent |

Dividing whatever number is handy by the target would make three of the four wrong. `INVESTED_CAPITAL`
in particular is *not* money deposited: selling a position releases its cost basis, and deposits and
withdrawals are capital flows rather than investment (see §3).

**A percentage target carries no currency and a money target must have one.** Both the Zod schema and
a check constraint enforce it, so the invariant survives anything that bypasses the schema. A money
goal in another currency is translated with the same FX table the holdings engine used; with no rate
the progress is `null` and the reason is printed, never a comparison of two currencies' numbers.

### Projections

Three scenarios — conservative, base, optimistic — with growth assumptions of 3%, 6% and 9%.

**Those numbers are planning placeholders, not forecasts, and not derived from anything.** They are
not the portfolio's own historical return: Stockly deliberately does not extrapolate a user's past
into their future. Every one is editable, and the figure the user chose is displayed beside the
result along with the method, the horizon, the starting value, the contribution and the currency.

The default monthly contribution *is* derived — from the user's own deposits over the last twelve
months — and is `null`, leaving the field at zero, when there is no history to average. "You
contribute nothing" and "we do not know what you contribute" are different statements.

The vocabulary is deliberate throughout. The strongest sentence the UI produces is *"the month the
model crosses the target under this assumption"*, never *"when you will reach your goal"*.

---

## 3. Return measurement

The distinction the whole of `domain/returns.ts` exists to enforce:

> A deposit raises the value of a portfolio without earning a cent.
> A withdrawal lowers it without losing one.

`(end − start) / start` is the formula that makes a portfolio look like it doubled when the user
simply paid in again. It appears nowhere.

**Time-weighted (TWR)** — how the *investments* performed, independent of when money arrived.
Sub-period returns with the flow removed, chained geometrically:

```
r  = (V_end − F) / V_start − 1
TWR = Π(1 + rᵢ) − 1
```

This is the only measure comparable to a benchmark, because an index has no deposits.

**Money-weighted (IRR)** — what *this investor* earned, given when they put money in. Solved by
bisection rather than Newton–Raphson: a cash-flow series can have a near-zero derivative, and a
Newton step overshooting below −100% yields `NaN` that would propagate into a portfolio figure.
Bisection cannot overshoot. `null` — never 0 — when the flows never change sign, the period is under
30 days, or no root exists in the bracket.

The flow is treated as arriving at the **end** of its sub-period. Stockly's valuations come from
`portfolio_snapshots`, written when a user opens the app, so an interval can span several days and
the approximation is correspondingly looser over one. Stated rather than hidden.

---

## 4. Risk

Two rules govern `domain/risk.ts`, and between them they decide most of its design.

**Risk is measured on flow-adjusted returns, never on raw portfolio value.** A drawdown computed
from value would report the day someone paid in as a rally. Everything consumes the TWR index.

**A statistic from too few observations is not a weak statistic — it is a made-up one.** Every
function has a stated minimum and returns `null` below it, which renders "N/A" with the reason
beside it.

| Metric | Minimum | Method |
|---|---|---|
| Volatility | 30 observations | sample σ (n−1) of period returns, annualised ×√252 |
| Sharpe | 30 observations | (annualised return − risk-free) ÷ annualised volatility |
| Max drawdown | 5 valuations | deepest peak-to-trough of the TWR index |
| Beta | 30 **paired** observations | cov(p, b) ÷ var(b), with R² |
| Concentration | 1 position | HHI, restated as "effective positions" (10000/HHI) |

The **risk-free rate is zero, disclosed**. Stockly has no risk-free curve and no defensible way to
pick a rate; rather than invent one, the assumption is "excess return over 0%", printed next to the
number. A caller with a real rate passes it in — nothing hardcodes a value into a result.

Annualising at 252 assumes the observed days are representative of trading days. Stockly's
observations are not strictly daily, which is the main reason its volatility can differ from a
broker's, and the UI says so.

Concentration reports **HHI**, a standard measure with a published meaning, rather than a bespoke
"risk score" — a score invented here would be a number nobody could argue with because nobody could
reproduce it.

Sector, country and currency exposure come from provider metadata and render "N/A" when there is
none. **Never inferred from a symbol.**

---

## 5. Benchmarks

`benchmarks` is shared reference data — the S&P 500 is the same index for everyone — so it has no
`user_id`, is readable by any signed-in user and writable by none. Rows live in the database rather
than in TypeScript so a deployment whose provider serves indices can add one without a code change.

`portfolio_benchmarks` links one benchmark to one portfolio, unique per portfolio.

**Index data is not on Twelve Data's free tier.** The adapter reports what its plan can actually
serve, caches that answer, and everything downstream renders "N/A" rather than an empty chart. Set
`BENCHMARK_PROVIDER=mock` for a deterministic synthetic index that exercises the comparison
arithmetic — it is obviously synthetic and labelled as such.

### The currency rule

A THB portfolio compared against a USD index reports **both returns, each labelled with its
currency, and a `null` difference.** Subtracting a baht-denominated return from a dollar-denominated
one produces a number that is not a difference in anything, and translating the benchmark would need
a historical exchange rate for every observation — which phase 9 established Stockly does not store.
The sentence explaining that always accompanies the null.

---

## 6. The insights engine

`domain/insights.ts`. **No model is involved.** Every insight is a threshold applied to a number the
calculation engine already produced, so the same portfolio always yields the same insights, each one
traces to a rule and a figure, and there is nothing to hallucinate.

Types: `CONCENTRATION`, `PERFORMANCE`, `DRAWDOWN`, `DIVIDEND`, `CASH`, `CURRENCY`, `BENCHMARK`,
`WIN_RATE`, `FEES`, `DATA`. Severities: `INFO`, `NOTICE`, `WARNING` — none of which means "act".

Three constraints, in order of how much damage breaking them would do:

1. **Describe, never advise.** `FORBIDDEN_INSIGHT_PATTERNS` is checked by a test against every
   sentence the engine can emit, using a fixture that fires every rule. It covers instructions
   ("sell", "you should"), forecasts ("will rise", "expected to") and ratings vocabulary
   ("overvalued", "price target").
2. **Never predict.**
3. **Never fire on a number that does not exist.** Every rule takes a nullable input and produces
   nothing when it is null. An insight generated from a missing figure is worse than silence,
   because it looks like knowledge.

`DATA` insights sort first among their severity, so a user reading top-down learns the figures are
incomplete before reading anything derived from them.

### Thresholds

Every number the engine branches on is in `INSIGHT_THRESHOLDS`, in one place, documented — so each
can be read, argued with and changed without hunting through rules, and so a test can assert an
insight fires on one side and not the other. A threshold decides whether something is *worth
mentioning*, never whether it is good or bad.

---

## 7. AI boundary

```
Stockly calculation engine  →  insights engine  →  structured facts  →  AI  →  prose
```

The model receives insights **already decided** by rules. It restates the ones that matter in
plainer words. The prompt tells it explicitly not to add one, not to contradict one, and not to
assign its own severity — and it could not invent one anyway, because the response schema still has
no numeric field and every figure on screen is retrieved.

Unchanged from phase 7: the model gets no tools, cannot query anything, and everything works with
`AI_ENABLED=false`.

**Journals and theses are never sent to the model.** They are the most personal content in the
application, they are not needed to describe a portfolio, and the AI context builder does not read
those tables.

---

## 8. Ownership and privacy

Every table follows the phase 8 pattern exactly: `user_id` on the row for RLS, plus a **composite
foreign key to `(portfolio_id, user_id)`** so a child row can only reference a portfolio belonging to
the same user. Isolation is the database's job, not a handler's.

An id from another user matches zero rows and returns 404 — which is also the right answer, since a
caller has no way to tell a row they cannot see from one that does not exist, and should not.

Journals and theses are additionally kept out of `robots.txt`, out of every push payload, and out of
the AI context.

---

## 9. Notifications

Phase 10 adds **no new alert types**, deliberately. The existing engine already covers the useful
threshold crossings:

- a `TOTAL_RETURN` goal is exactly `PORTFOLIO_TOTAL_RETURN_ABOVE`;
- a drawdown threshold is `PORTFOLIO_DAILY_CHANGE_BELOW` over a shorter window.

A third way to express the same condition would be a third state machine to keep consistent, for no
capability the user does not already have. The phase 5 rule stands and matters more here than
anywhere: **a push payload never contains a portfolio figure.** A lock screen is not a private
surface, and a goal-progress notification saying "you have reached ฿1,248,523" would be the exact
disclosure that rule exists to prevent.

---

## 10. Performance

One `loadIntelligence` pass serves the dashboard, the review page and the AI context. It is
`cache()`d and calls the already-cached `loadAnalytics`, so goal progress, insights, risk and the
benchmark cost **no extra pass over the transactions and no extra quote call**.

Everything else is a pure function of data already in hand. The only thing that can touch the
network is the benchmark series, which degrades to `null` on its own.

The N+1s that were available and avoided: sell reviews are one query for the whole portfolio rather
than one per closed trade; theses are one query keyed by instrument rather than one per holding.

---

## 11. Deliberately not here

- **Automatic thesis invalidation.** The system shows facts; the user draws the conclusion.
- **A composite "risk score".** HHI and volatility are checkable. A score would not be.
- **Historical FX**, and therefore a cross-currency benchmark difference. Phase 9's constraint.
- **Multiple benchmarks per portfolio.** Needs a comparison UI nobody has asked for.
- **Full-text journal search.** `ilike` over title and content is enough for a personal journal; a
  tsvector column is a migration nobody needs yet.
