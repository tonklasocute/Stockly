# Stress testing

Phase 20. What a portfolio would be worth under assumptions the user chose, and — just as
importantly — what the answer does not cover.

## There is no second engine

Every figure a stress test produces comes from `simulateWhatIf`, the phase 11 what-if engine. This
is not an implementation convenience; it is the property that makes a stress figure trustworthy.
If stress testing had its own valuation code, a stress result and the dashboard could disagree
about what the portfolio is worth today, and there would be no way to tell which was right.

`domain/stress.ts` adds four things and calculates nothing itself:

| | |
|---|---|
| **Builders** | Turn "US technology −20%" into the per-instrument `PriceAdjustment[]` the engine takes — exactly the shape `uniformPriceShock` has had since phase 11. |
| **Coverage** | Which holdings the scenario reached, which it correctly left alone, and which it could not reach. |
| **Decomposition** | A combined scenario broken into each assumption's marginal effect, summing exactly to the whole. |
| **Recovery** | The arithmetic that existed nowhere: what a fall requires to undo it. |

The module has no client, no writer, no network, no framework import and **no clock**. `calculatedAt`
is passed in, which is what makes a run reproducible and a test able to assert equality.

## It is not a forecast, and the code enforces that

Two devices, the same pair used by `domain/insights.ts` and `domain/technical.ts`:

- **`STRESS_DISCLAIMER`** — a fixed constant, `"Hypothetical scenario — not a forecast."`, rendered
  at the top of the stress screen. Fixed so it cannot drift into something softer.
- **`FORBIDDEN_STRESS_PATTERNS`** — checked by a test against every sentence the module *generates*.
  No "will rise", no "expected return", no "likely to", no "recommend", no "too risky".

The disclaimer deliberately lives outside the checked text. The patterns are blunt by design — the
word "forecast" at all — and a disclaimer that must say the word cannot sit inside the checked set
without weakening the check for every other sentence. Separating them keeps the guarantee strict
where prose is generated and keeps the disclaimer exact where it must not move.

## Components

```
UNIFORM      every holding
INSTRUMENT   one holding, keyed by market as well as symbol
MARKET       every holding on that venue
SECTOR       every holding with that sector classification
CURRENCY     the rate one currency translates into the base at
```

**Components compound; they do not replace.** A holding caught by both "US −15%" and
"Technology −20%" ends at 0.85 × 0.80 = 0.68. Applying only the last one would silently discard the
other, and two simultaneous assumptions are two assumptions.

**A price cannot go below nothing.** A −150% component clamps at −100%.

### The currency direction, stated once

> A positive move means one unit of that currency is worth **more** of the portfolio's base
> currency, so holdings denominated in it are worth more. It does not change any instrument's own
> price.

For a baht-based portfolio, "USD +10%" means the dollar buys 10% more baht, so the American
holdings are worth more baht — while every American share price is unchanged. Asset price and
exchange rate are separate assumptions, applied separately, and `CURRENCY_DIRECTION` is printed in
the assumptions panel whenever a currency component is present.

The **base currency is never shocked**: its rate is the identity, and "shocking" it would be
shocking everything else by the reciprocal — a different scenario written confusingly.

A currency with no real rate gets no override. The scenario cannot invent a rate any more than the
portfolio could.

## Coverage, and the distinction that matters

```
total = shocked + unaffected + excluded
```

- **shocked** — the scenario moved it.
- **unaffected** — the scenario correctly left it alone. A Thai holding in a US-market shock is the
  scenario *working*. Listing it as a gap would bury the real ones.
- **excluded** — the scenario should have reached it and the data would not let it. Two reasons:

| | |
|---|---|
| `NO_SECTOR` | The provider returned no sector, so a sector shock cannot be applied. |
| `NO_FX_RATE` | No rate reaches the base currency, so the holding is in no total at all. |

That three-way split is the whole point of reporting coverage. "18 of 20 holdings, 2 excluded — no
sector classification" is a usable sentence; "covers your portfolio" is not.

## Decomposition

Components are applied cumulatively in the order given, and each one's impact is the change it makes
on top of the ones before it. The parts sum to the whole **exactly**, because each is a difference
between two runs of the same engine.

**The order is part of the answer**, and the assumptions panel says so. With compounding assumptions
there is no order-free attribution; pretending otherwise would be a made-up allocation of a real
number — the same reason `domain/attribution.ts` displays its residual instead of distributing it.

## Recovery arithmetic

```
value → value × (1 + d)     recovering needs     1 / (1 + d)
required gain = −d / (1 + d)
```

| Fall | Gain required to return |
|---:|---:|
| −10% | +11.11% |
| −20% | +25% |
| −50% | +100% |
| −80% | +400% |

`null` in the two cases where the question does not apply:

- **nothing was lost** — a rise needs no recovery;
- **everything was lost** (−100% or beyond) — no finite gain restores a value of zero.

Both render `N/A`, which is truthful, rather than a very large number that reads like an estimate.

The label is **"Gain needed to return to the starting value"**, never "expected recovery" and never
a time. Stockly has no basis for saying how long anything takes.

## The scenario matrix

Falls of −5, −10, −20, −30 and −50%. **Every row is a full run of the engine**, not the first row
scaled: cash does not fall and untranslatable holdings are in no total, so the relationship between
a price shock and a portfolio impact is not proportional. Scaling one row would quietly misstate
the rest — a 10% price fall on a portfolio that is a third cash is a 6.7% portfolio fall.

## The historical scenario

The magnitude is `drawdownHistory`'s deepest **observed** event, measured on the flow-adjusted
return index so a deposit was never mistaken for a recovery. Nothing is invented: with too little
history the answer is `N/A` and the screen says why.

`DrawdownEvent.depthPct` is a **positive depth** — a 20% fall is `20`. A shock component is a signed
move. `historicalScenario` negates it, and a test pins that conversion, because reading it straight
through would apply the worst fall in a portfolio's history as a rally.

It is labelled a historical scenario and carries its dates. That it happened once says nothing about
whether it happens again, and the note says so in those words.

## What it cannot touch

`domain/financial-integrity.test.ts` runs the stress engine, the matrix, the what-if engine,
reconciliation, share adjustments, attribution, drawdown history, the data-quality scan and the
insights engine against one fixture, then compares the **complete derived financial state** — every
position, trade, holding, summary figure and cash balance — before and after. Byte for byte. Then
it does it again, twice over, and then once per operation so a failure names the culprit.

There is also no endpoint. The stress tab runs entirely in the browser, like the rest of the
planning workspace, because the engine is pure. Nothing it produces can be stored, because there is
nowhere to store it.

## Scale

`domain/scale.test.ts` runs the engines against **1,000 holdings and 10,000 transactions** across
two markets: replay, valuation, cash, per-currency cash, a combined stress scenario with sector
coverage, the full matrix, position reconciliation and split adjustments. The whole suite completes
in roughly 200 ms locally.

The timing ceilings in that file are loose — at least fifty times the observed figure — on purpose.
A tight assertion on shared CI hardware is a flaky test, and a flaky test in a financial suite gets
ignored. They exist to catch an accidental O(n²), which is exactly what they caught: coverage
accounting searched the result list once per holding before this phase, a million comparisons at
that size, and is indexed now.

**This measures the engines, not the application.** The dashboard's end-to-end latency cannot be
measured in this repository, because no database has ever been attached to it. See
`docs/phase-20-final-report.md` for what that leaves unproven.
