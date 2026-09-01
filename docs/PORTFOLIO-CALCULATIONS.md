# Portfolio calculations

Every formula Stockly uses, with the definition it commits to. If a number on screen disagrees with
this file, one of the two is a bug — this file is the specification, `domain/` is the implementation,
and `domain/*.test.ts` is the proof.

All of it is pure: no database, no network, no React. That is what makes it testable, and testable is
what makes it trustworthy.

---

## 1. Precision

Storage is PostgreSQL `numeric(20,8)`. In the engine, every accumulation goes through
[`domain/money.ts`](../domain/money.ts), which sums over scaled integers rather than doubles.

```
sum([0.1, 0.2])          → exactly 0.3
1000 additions of 0.01   → exactly 10
```

Plain `+` on doubles gives `0.30000000000000004` and `9.999999999999831`. Formulas are unchanged;
only the points where values accumulate go through `sum`, `add`, `multiply`. Money uses six decimal
places (exact to about $9 billion), quantities eight (matching the column).

**Rule:** a new aggregate uses `sumBy`, never `reduce((a, b) => a + b)`.

---

## 2. Cost basis — weighted average

```
BUY   quantity      += q
      investedValue += q × price + fee

SELL  sold      = min(q, quantity)                  ← clamped; an oversell cannot go negative
      costOut   = sold == quantity ? investedValue   ← closing releases the exact basis, no dust
                                   : averageCost × sold
      proceeds  = sold × price − fee
      realized += proceeds − costOut
      quantity      -= sold
      investedValue -= costOut

averageCost = quantity > 0 ? investedValue / quantity : 0
```

Fees raise the basis on a buy and reduce the proceeds on a sell — how retail brokers report it, and
how the cash actually moves. FIFO would live beside this function, not replace it.

Worked example:

```
BUY  10 NVDA @ 170        invested 1,700   avg 170.00
BUY   5 NVDA @ 180        invested 2,600   avg 173.333333  (2600 / 15)
SELL  5 NVDA @ 190        costOut  866.67  realized +83.33  avg still 173.33
```

Selling never changes the average cost of what remains. That is the definition of the method.

---

## 3. Valuation

```
marketValue    = quantity × currentPrice
unrealizedPnl  = marketValue − investedValue
returnPct      = unrealizedPnl / investedValue × 100
weight         = marketValue / Σ marketValue × 100
```

No quote → the holding is priced at `averageCost` and flagged `stale`. It shows flat rather than
inventing a loss, and the UI says so.

### Today's change

```
todayPnl       = quantity × (currentPrice − previousClose)
todayReturnPct = (currentPrice − previousClose) / previousClose × 100
```

**No previous close → `null`, never 0.** "Unknown" and "unchanged" are different claims. The portfolio
figure sums only the holdings that have one, and its percentage is against those same holdings'
value yesterday.

---

## 4. Cash

```
balance = deposits − withdrawals − buyCosts + sellProceeds + netDividends

buyCosts      = Σ (q × price + fee)     ← the fee is inside; never subtracted twice
sellProceeds  = Σ (q × price − fee)
netContributed = deposits − withdrawals
```

The balance may be negative. That means trades were recorded without the deposit that funded them —
an incomplete history, shown honestly rather than clamped to zero and hidden.

`netContributed`, not market value, is the money the user actually put in.

---

## 5. Performance vs. capital flow

The distinction the whole analytics page rests on:

> A $10,000 deposit raises portfolio value by $10,000 and earns nothing.

So performance is never "value today minus value on day one". Each snapshot reports:

```
gain    = totalValue − (investedValue + cashValue)
gainPct = gain / investedValue × 100
```

A deposit raises `totalValue` and `cashValue` by the same amount; they cancel. Only price movement
and realized profit move `gain`.

**Absolute return** = current value − net invested capital.
**Return %** = profit / cost basis × 100.

Time-weighted and money-weighted return are not implemented. They need a valuation at every cash-flow
date, which requires the snapshot history to be dense; the insertion point is `performanceSeries`.

---

## 6. Allocation and concentration

```
total     = Σ holding marketValue + max(cash, 0)
weight    = value / total × 100
```

Cash is a slice, so weights sum to 100%. A 40%-cash portfolio is a fact, not a rounding artefact.

Grouping by sector, industry, country or currency uses provider metadata. **A symbol with no metadata
lands in "Unknown", never dropped** — a chart that silently omits 30% of a portfolio is a lie. Unknown
always sorts last. When every holding is Unknown the section is hidden rather than shown empty.

```
largest    = the single biggest weight
top3/top5  = Σ of the 3 / 5 largest weights
level      = largest ≥ 40% or top3 ≥ 70% → concentrated
             largest ≥ 25%               → moderate
             otherwise                   → diversified
```

These thresholds describe. They never advise: "This portfolio is concentrated in a few positions",
never "you should sell NVDA".

---

## 7. Realized P&L statistics

**A trade is one sell** — the moment profit is booked. Under weighted-average cost that is the only
point at which a gain becomes real.

```
winning    realizedPnl > 0
losing     realizedPnl < 0
breakEven  realizedPnl == 0

winRate = winning / (winning + losing) × 100
```

Break-even trades decide nothing and are **excluded from the denominator**, not counted as losses.

```
averageWin  = Σ winning  / count(winning)
averageLoss = Σ losing   / count(losing)
```

`null`, not 0, when nothing has been sold.

### Average hold time

Reported **only over closed positions**: the span from the buy that opened the run of ownership to the
sell that closed it. A partial sell has no single purchase date under weighted-average cost, so it
contributes nothing rather than an estimate. With no closed position the metric reads N/A.

---

## 8. Contribution

```
total  = realized + unrealized      per symbol
weight = total / Σ |total| × 100
```

The denominator is the sum of **absolute** contributions. With +$500 and −$500 the net is zero, and
dividing by it would give infinities instead of "each accounts for half the movement".

---

## 9. Fees

```
total            = Σ fee
percentOfTurnover = total / Σ (quantity × price) × 100
```

Turnover counts buys and sells, because both cost money.

---

## 10. Dividends

```
gross = shares × dividendPerShare
net   = gross − tax − fee
```

Net is what reaches cash, so every total and yield below uses net. Gross is kept for reconciling
against a broker statement.

```
trailing12m = Σ net where paidOn within the last 365 days
averageMonthly = totalNet / months actually covered
```

Averaged over the months the history covers, not over 12 — a three-month-old portfolio would
otherwise report a quarter of its real rate.

### The two yields

They are **not** interchangeable, and neither is called "dividend yield" on its own:

```
Yield on current value = trailing12m / marketValue    × 100
Yield on cost          = trailing12m / investedValue  × 100
```

Same numerator, different denominators. Conflating them is how a portfolio appears to yield 9% when
it yields 3%. Both use trailing actual payments — Stockly does not forecast a forward yield.

`null` when the denominator is zero: "no yield yet" is not "a yield of zero".

---

## 11. Snapshots

Portfolio **value** over time cannot be derived from transactions — it needs a market price for every
past day, which a free provider tier cannot supply. So value history accumulates forward, one row per
portfolio per day, written when the analytics page renders (the quotes were already fetched).
`unique (portfolio_id, snapshot_date)` makes a reload refresh the row rather than duplicate it.

A snapshot is **skipped** when market data failed or any holding is stale, so a fallback valuation is
never baked into history.

Invested capital, by contrast, **is** derivable from transactions, so it is never stored —
`investedCapitalSeries` reconstructs it exactly, from the first transaction onwards.

---

## 12. Cache invalidation

One helper, [`lib/cache.ts`](../lib/cache.ts). Anything that changes a portfolio's numbers — a
transaction, dividend, cash movement or the portfolio itself — calls `invalidatePortfolio()`, which
revalidates every route that derives from those rows together. There is no stored aggregate to
update: the pages recompute from Supabase, so invalidation means re-rendering, not recalculating.

Market-data responses are cached separately by tag, so a new transaction does not throw away a quote
that is still fresh.
