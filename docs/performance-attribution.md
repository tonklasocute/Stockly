# Performance Attribution (Phase 16)

What a portfolio's return was made of, how the number is derived, and the cases where it is
deliberately narrower than it looks.

---

## 1. The problem with the textbook formula

The standard single-period contribution is:

```
contribution_i = weight_i × return_i
```

It is wrong here, and it is worth being precise about why. That formula assumes a position's weight
is **constant across the period** — which stops being true the moment somebody buys or sells, and
recording that somebody did is the entire purpose of a portfolio tracker. Applied to a position
bought halfway through a month, it credits that position with a return it was not held for.

Every serious implementation solves this by breaking the period at each cash flow and chaining the
sub-periods. That needs a **valuation at every flow date**, which needs a historical price for every
holding on every one of those dates. Stockly does not store a price history (see §6), so that path
is not available.

## 2. What is computed instead

Contribution is measured in **money**, not in weights:

```
gain_i         = (endValue_i − beginValue_i) − invested_i + divested_i + dividends_i
contribution_i = gain_i / beginningValue × 100
```

where, over the period:

| Term | Meaning |
|---|---|
| `beginValue_i` / `endValue_i` | the position's base-currency value at each end |
| `invested_i` | money paid into it — buys, fees included |
| `divested_i` | money taken out of it — sale proceeds, sell fees deducted |
| `dividends_i` | income received from it |

Subtracting `invested_i` is what stops a purchase looking like a gain: the money did not appear, it
moved. It is the same principle the portfolio's own return uses when it removes deposits, applied
one level down.

### Why the parts sum to the whole

```
totalGain = endingValue − beginningValue − netFlow
```

Both sides remove the same external money over the same period in the same currency, so the
components add up **because the arithmetic makes them**, not because a weighting scheme was chosen
to force it. That is the property that lets a waterfall chart be honest, and
`attribution.test.ts` asserts it across buys, sells and dividends together.

### Worked example

Start at 10,000, all in stocks. During the period: 1,000 deposited, 800 spent on B, 200 of C sold,
100 of dividends from A.

```
stocks at end   4,500 + 4,100 + 3,500 = 12,100
cash at end     1,000 − 800 + 200 + 100 =   500
ending value                             12,600
total gain      12,600 − 10,000 − 1,000 =  1,600

A   (4,500 − 4,000) − 0   + 0   + 100 =   600
B   (4,100 − 3,000) − 800 + 0   + 0   =   300
C   (3,500 − 3,000) − 0   + 200 + 0   =   700
                                        ─────
                                         1,600  ✓
```

## 3. Contribution is not the holding's return

Both numbers are shown, side by side, because they answer different questions and are routinely
confused:

- **Holding return** — what the position did with the money in it. `gain_i / (begin_i + invested_i)`.
- **Contribution** — what the position did to the *portfolio's* return, in percentage points.

A position up 40% that was 2% of the portfolio contributed under a point. Showing only the first
overstates its importance; showing only the second hides that it was an excellent holding.

## 4. Price and dividend components

```
dividendGain = Σ dividends_i
priceGain    = totalGain − dividendGain
```

These are **slices of the same total**, not additions to it. Adding "price + dividends + total"
into one chart would double-count, and the panel labels them as a split rather than as a sum.

A dividend that was never recorded is not a dividend of zero — it is a coverage gap, and the
data-quality centre reports it as one. The engine reports what it was told.

## 5. Currency: always N/A, and why

`fxGain` is typed `null` and always is.

Separating currency movement from asset performance needs the exchange rate on **every day of the
period**. Stockly has never stored one: `domain/fx.ts` fetches today's rate and caches it for ten
minutes. Phase 16 adds `fx_rates_daily`, which begins accumulating rates from the day it is
deployed — so the capability becomes possible *going forward* and remains impossible for any period
that predates the first stored rate.

Reporting a number here would mean interpolating a rate nobody observed and presenting the result
as an analytic. `docs/fx-attribution.md` sets out exactly what would have to exist first.

## 6. The honest limitation of this implementation

**Stockly stores no per-holding price history.** A position's value is known for *today* — from the
batched quote call the page already makes — and is `null` at the start of any past period.

The consequence, stated rather than buried: for a holding that was held unchanged through the whole
period, `beginValue` is null and its measured gain captures only what happened to money moved during
the period. That **under-reports** it, and the shortfall lands in the residual.

Which is why the residual is displayed rather than distributed:

```
residual = totalGain − Σ gain_i
```

A non-zero residual is *evidence* that something was not captured, and the panel names the holdings
that could not be valued. Scaling the parts until it vanished would destroy the evidence and produce
a chart that looks complete and is not.

Closing this properly means storing daily closes per held instrument — a real feature with a real
provider cost, described in `docs/historical-rebuild.md` §4.

## 7. Basis, and not mixing it with TWR

The engine reports `basis: "MONEY_WEIGHTED"`, and every screen states it.

| | Question it answers | Where it is used |
|---|---|---|
| **TWR** | How did the strategy do, independent of when money arrived? | Review page, benchmark comparison |
| **MWR / IRR** | What did this investor actually earn? | Review page |
| **Attribution** | What was the money-terms gain made of? | History page |

They are not interchangeable and the history page never labels a figure just "return".

## 8. Benchmark: active return only

```
activeReturn = portfolioReturn − benchmarkReturn
```

Null when either is missing, and null across a currency mismatch — subtracting a baht-denominated
return from a dollar one produces a number that is not a difference in anything.

**Brinson-style allocation and selection effects are deliberately not computed.** They require the
benchmark's own weights and constituent returns; a benchmark here is a single price series.
Producing an "allocation effect" from a series alone would be an invented number in a shape that
looks authoritative — the worst combination available.

## 9. Drawdowns

Measured on the **flow-adjusted return index**, never on portfolio value, so a deposit cannot look
like a recovery and a withdrawal cannot look like a fall.

A drawdown runs peak → trough → recovery, and **recovery means regaining the old peak**, not merely
rising. Falls shallower than `MIN_REPORTABLE_DEPTH_PCT` (5%) are not listed: a daily series makes
dozens of small dips and listing them hides what actually happened.

An unrecovered drawdown is reported as ongoing. Stockly never projects a recovery date.

The regime labels — `GROWING`, `FLAT`, `DRAWDOWN`, `RECOVERING` — are arithmetic states of one
portfolio's own index. They are deliberately **not** "bull market" or "bear market", which are
claims about a market regime with a methodology behind them.

## 10. Vocabulary

Every sentence this layer produces is checked against `FORBIDDEN_INSIGHT_PATTERNS` — the same list
the insights engine is held to.

> "TSLA removed 1.4 percentage points of the portfolio's return."

is a fact about a period that has happened. "TSLA is dragging the portfolio down and should be
reviewed" is advice, and Stockly does not give advice.
