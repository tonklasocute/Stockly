# Planning and simulation (phase 11)

Phases 1–10 answered questions about a portfolio that exists. Phase 11 answers questions about ones
that do not: *what if I paid in ฿20,000 a month, what would it take to reach ฿5,000,000, what
happens to my book if NVDA falls 30%.*

One sentence governs the whole phase, and every design decision below follows from it:

> **A simulation is arithmetic on assumptions the user chose. It is never a prediction.**

That is why a field is called `annualReturn` and not `expectedReturn`, why a result is a `scenario`
value and not a forecast, why the gap against a goal is a **projected gap** rather than "you will
miss your goal", and why the assumptions travel with every number they produced, everywhere.

---

## 1. Architecture

```
Actual portfolio  →  current state  →  simulation engine  →  scenario result
```

There is no arrow back. `domain/simulation/` has **no database client, no network, no model, no
framework import and no writer** — a test reads the source of every file in it and fails if one
appears. Given the same inputs it returns the same numbers forever, which is what makes a result
something a user can check rather than something they have to trust.

```
domain/simulation/
  types.ts          scenario model, timing/frequency conventions, error codes
  growth.ts         compound growth and DCA — one calculation, two names
  goal-plan.ts      projection against a target, required contribution, scenario matrix
  dividend-plan.ts  income projection, with reinvestment
  what-if.ts        portfolio restated at chosen prices, quantities and rates
```

**No endpoint runs a simulation.** Every calculation is pure, so it runs in the browser as a slider
moves — no round trip, no debounce to tune, no second place for the formula to live. The server is
involved only when a scenario is *saved*.

### One growth engine

Phase 10 had its own monthly compounding inside `domain/goals.ts`. Phase 11 deleted it rather than
adding a second: `projectGoal` and its UI are gone, and everything routes through `simulateGrowth`.
Two implementations of the same arithmetic is two places for it to be wrong differently.

---

## 2. Formulas

### Periodic rate

```
r = (1 + annual) ^ (1 / periodsPerYear) − 1
```

Geometric, **not** `annual ÷ periods`. Compounding twelve monthly rates must reproduce the annual
figure exactly; dividing would quietly understate it — 8% ÷ 12 compounded twelve times is 8.30%, so
a ten-year projection drifts by thousands.

### Future value

```
FV = P(1+r)ⁿ + C · [((1+r)ⁿ − 1) / r]           contributions at period END
FV = P(1+r)ⁿ + C · [((1+r)ⁿ − 1) / r](1+r)      contributions at period BEGIN
FV = P + C·n                                     when r = 0
```

`r = 0` is handled separately rather than by the general expression, which would divide by zero.

Implemented **twice, deliberately**: the closed form (`futureValue`) for the solver to invert, and a
period-by-period loop (`simulateGrowth`) because a chart needs the series anyway and an escalating
contribution has no tidy closed form. A test asserts the two agree to nine decimal places wherever
both apply — that is what stops the cheap one and the exact one drifting apart.

### Required contribution

The annuity formula inverted:

```
C = (FV − P(1+r)ⁿ) / ( [((1+r)ⁿ − 1) / r] × timing )
C = (FV − P) / n                                        when r = 0
```

Returns **0** — a real answer, not a missing one — when the target is already covered by the current
value or by growth alone.

### Inflation

```
real value  = nominal / (1 + inflation) ^ years
real return = (1 + nominal) / (1 + inflation) − 1
```

The Fisher relation, not `nominal − inflation`: the subtraction is an approximation that is already
wrong by a tenth of a point at 8% against 3%.

**`inflationRate: null` means the question was not asked**, and every real-value output is then null
too — not zero inflation, which is itself an assumption and a wrong one to make on someone's behalf.

### Dividends

```
income(year)      = portfolio value at year end × yield(year)
yield(year)       = base yield × (1 + yield growth) ^ (year − 1)
yield on value    = income ÷ that year's portfolio value
yield on cost     = income ÷ original cost basis
```

Two yields, two names — as everywhere else in Stockly. They share a numerator and nothing else, and
calling either just "dividend yield" is how a 3% portfolio appears to yield 9%.

With reinvestment on, each year's income is added to the portfolio at year end and compounds
thereafter. It is counted as **growth, not as a contribution**: the money came from the portfolio,
not from the investor.

---

## 3. Conventions

**Contributions land at the END of each period.** Stated in the assumptions panel of every
simulation, so the convention is never implicit. `BEGIN` is implemented and tested because the
difference is real — an annuity-due earns one extra period on every payment — but nothing in Stockly
passes it, and it is not exposed as an input: there is no reason to make a user choose, and a silent
switch would make two runs of the same scenario disagree.

**Contribution escalation is annual, not per period.** A "5% annual raise" compounding monthly would
be 79% over ten years instead of 63%.

**Rates are decimal fractions inside the engine and percentages on the wire.** A number that is
sometimes 8 and sometimes 0.08 is the arithmetic bug that survives every review, so the two forms
meet in exactly one place: `toScenario`.

**Precision.** The running balance is carried at full double precision and quantized only when it is
written into a point. Rounding the balance and feeding it back would compound the rounding error
along with the money — over 600 monthly periods that is a visible and entirely invented difference.
Currency formatting happens at the very edge, through `lib/format.ts`.

---

## 4. Edge cases

Every simulation returns a result **or a reason code** — never `NaN`, never `Infinity`, never a
plausible-looking number derived from an impossible input.

| Input | Behaviour |
|---|---|
| return = −100% | Modelled. Each period wipes the balance out and only contributions since survive. |
| return < −100% | Refused: a negative base to a fractional power is not a real number. |
| return = 0 | Modelled through the separate `r = 0` branch, never a division by zero. |
| duration ≤ 0, or > 50 years | Refused. Past 50, compounding an assumed rate says nothing. |
| negative start or contribution | Refused. |
| non-finite anything | Refused. |
| target ≤ current value | "Already reached"; the required contribution is 0. |
| no dividend history | `null` — an unknown future income, not a projection of zero. |
| no FX rate | The holding is excluded from scenario totals and counted, exactly as the real portfolio does. |

---

## 5. Multi-currency

A simulation runs in the **portfolio's base currency**, stated in the assumptions panel.

The what-if simulator can override an exchange rate per currency — the user types "35 baht to the
dollar" and the panel restates every THB holding at it, showing the effect on the base-currency
total and on allocation while leaving the native values untouched. That is a scenario calculation
only; nothing here predicts an exchange rate.

A holding with no real rate and no override stays untranslatable and is reported, never valued at a
made-up rate. Supplying a scenario rate for it is a legitimate way to bring it into the total —
explicitly, which is the point.

---

## 6. Actual versus projected

The most important piece of UI in this phase is a word. Four labels, applied consistently:

| Label | Means |
|---|---|
| `ACTUAL` | Recorded. A dividend that was paid, a portfolio value from real prices. |
| `PROJECTED` | Computed forward from assumptions. |
| `SCENARIO` | A restatement of something real under chosen inputs. |
| `ASSUMPTION` | An input the user chose. |

Projected series are drawn **dashed**, never styled like the actual performance line on the analytics
page — that would be a visual claim the data does not support. Actual dividend income sits in its
own card and is never added to a projected figure or charted beside one.

Every simulation carries an assumption panel that is neither collapsible nor hidden, containing the
engine's own description of what it did (printed verbatim, not paraphrased) and a plain disclaimer:
scenario results are arithmetic on assumptions the user chose, not forecasts, not guarantees, not
advice.

### Example assumptions

The three named scenarios — conservative 5%, base 8%, optimistic 10% — are **placeholders, not
forecasts, and not derived from anything.** They are not a house view, and deliberately not the
user's own historical return: extrapolating somebody's past into their future is exactly what this
codebase refuses to do implicitly. Picking one fills the rate field and leaves it editable, the
picker says "example assumptions, not forecasts", and the figure actually used is shown beside every
result.

Two defaults *are* derived, and both from the user's own data: the starting value (their portfolio)
and the suggested contribution (their average net deposit over twelve months). Both are `null` when
there is no history to ground them in, because "we do not know" and "zero" are different statements.

---

## 7. Saved scenarios

`saved_simulations` stores **inputs, never results**. There is no projected-value column. Everything
a scenario produces is recomputed from its inputs when it is opened, by the same pure functions that
produced it the first time — so a saved scenario cannot go stale, cannot disagree with a fresh run
of itself, and can never be mistaken for a record of something that happened.

Ownership follows the phase 8 pattern: `user_id` for RLS, plus a composite foreign key to
`(portfolio_id, user_id)` so a scenario can only reference a portfolio belonging to the same user.
An id from another user matches zero rows and returns 404. Capped at 50 per user, by a count the
database can answer.

`portfolio_id` is nullable — a compound-growth calculation is not about a particular book — and a
`WHAT_IF` scenario is the one type that requires it, since it has nothing to start from otherwise.

**The what-if scratchpad is deliberately not saveable.** Its whole value is that it can be discarded;
persisting one would turn an experiment into a record.

---

## 8. Invariants

`domain/simulation/invariants.test.ts` proves the property this phase most needs:

- A full portfolio is built, every simulation is run against it at once, and holdings, cost basis,
  realised P&L, unrealised P&L and cash are asserted **byte-identical** afterwards — both the
  objects and a fresh re-derivation from the transactions.
- The engine returns new objects rather than the ones it was given.
- The same inputs produce the same output.
- The source of every file in the folder is read and checked for a client, a writer, a fetch or a
  framework import.

Transactions remain the single source of truth. A simulation cannot create one.

---

## 9. Performance

Nothing recalculates a portfolio when a slider moves. The page loads one cached snapshot —
`loadIntelligence`, itself over the cached `loadAnalytics` — hands it to the browser, and the engine
runs locally against it. `useMemo` keeps a recomputation off the render path when nothing changed.

The server does no simulation work at all, which is why there is no simulation endpoint to rate
limit and no debounce to tune.

---

## 10. AI boundary

Unchanged, and the arrow gains a segment:

```
simulation engine → structured results → insight engine → AI → prose
```

If AI is enabled, it would receive numbers Stockly computed. It does not calculate, invent
assumptions, predict returns or prices, recommend anything, or modify a simulation. Today it is not
wired to simulations at all: nothing in `features/ai` reads a scenario, and everything works with
`AI_ENABLED=false`.

---

## 11. Deliberately not here

- **Monte Carlo.** A deterministic foundation first; a distribution of outcomes is its own phase,
  and bolting one onto an engine whose conventions were not yet settled would bake them in.
- **Portfolio optimisation, efficient frontiers.** These recommend allocations. Stockly describes.
- **Automatic execution of any kind** — no scheduled DCA, no deposits, no trades.
- **Price or FX prediction.** A scenario price is a number the user typed.
- **Tax modelling.** Stated as an exclusion in every method string rather than approximated.
- **Weekly contributions.** Monthly, quarterly and yearly cover the cases anyone has; a fourth
  frequency is one line when someone needs it.
