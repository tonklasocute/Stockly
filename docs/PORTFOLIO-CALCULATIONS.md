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

**In the instrument's own currency** — the one it is quoted in, whatever the portfolio is kept in:

```
marketValue    = quantity × currentPrice
unrealizedPnl  = marketValue − investedValue
returnPct      = unrealizedPnl / investedValue × 100
```

No quote → the holding is priced at `averageCost` and flagged `stale`. It shows flat rather than
inventing a loss, and the UI says so.

### Translation into the portfolio's base currency (phase 9)

```
baseMarketValue    = marketValue    × rate      or null when there is no rate
baseInvestedValue  = investedValue  × rate      or null
baseUnrealizedPnl  = unrealizedPnl  × rate      or null
weight             = baseMarketValue / Σ baseMarketValue × 100   or null
```

`rate` is **one rate per holding**, applied to every figure and reported to the user beside them, so
the arithmetic on screen can be checked. When the instrument's currency is already the base currency
the rate is 1 and no provider is consulted — which is why every pre-phase-9 portfolio produces
byte-identical numbers.

**No rate → `null`, never 0 and never 1.** A holding that cannot be translated is left out of every
total and counted in `summary.untranslatedCount`, which the page turns into a sentence. Defaulting to
1 would value a ฿32 stock at $32; defaulting to 0 would erase a real position from a real total.

`weight` is a share of the portfolio, so it only means anything once every holding is on the same
scale. A holding with no rate has **no knowable share** — `null`, not 0.

`returnPct` divides two figures in the same currency, so no exchange rate can move it. Stock
performance is never contaminated by currency movement.

### FX effect

`summary.fxEffect` is **always `null`**, by type. Separating currency movement from stock performance
needs the exchange rate on every past trade date, and Stockly stores none. Base-currency figures are
a translation at *today's* rate, labelled as such on every page whose totals crossed a currency
boundary. See [`MULTI-MARKET.md`](MULTI-MARKET.md) §3 for what would have to exist first.

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
balance = netContributed − buyCosts + sellProceeds + netDividends + interest − charges

buyCosts       = Σ (q × price + fee)     ← the trade fee is inside; never subtracted twice
sellProceeds   = Σ (q × price − fee)
netContributed = capital in − capital out
charges        = Σ (fee + tax)           ← ACCOUNT-level charges only, not trade fees
```

The balance may be negative. That means trades were recorded without the deposit that funded them —
an incomplete history, shown honestly rather than clamped to zero and hidden.

`netContributed`, not market value, is the money the user actually put in.

### Which kinds are capital (phase 19)

The ledger has nine kinds, and they divide along the line every performance figure depends on:

| | Kinds | Treatment |
|---|---|---|
| **Capital flows** | `deposit` `withdrawal` `transfer_in` `transfer_out` `adjustment_in` `adjustment_out` | Cross the portfolio's boundary. Removed from both sides of every return figure. |
| **Outcomes** | `fee` `tax` `interest` | Happened *to* the portfolio. Part of performance; never contributed capital. |

A custody fee is not a withdrawal — the portfolio did worse, it was not drawn down. A transfer in is
contributed capital in exactly the way a deposit is. `CASH_FLOW_DIRECTION` and `CAPITAL_FLOW_KINDS`
in `domain/cash.ts` are the single statement of both rules; nothing anywhere tests for one kind by
name.

### Per-currency balances

`computeCashByCurrency` computes the same figures **once per currency, with no exchange rate in any
of them**. A trade's currency is its market's; a cash movement's and a dividend's are stored. Nothing
is summed across currencies, and there is deliberately no combined total — that is what
`computeCash` is for, and it is only safe because its callers translate first and drop what they
could not translate.

This is the figure a broker statement is reconciled against: a statement reports a dollar balance
and a baht balance, never a translated one.

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

All allocation figures are in the portfolio's base currency, since a pie whose slices are in
different currencies compares nothing. A holding with no exchange rate cannot be placed on that scale
and is excluded — reported through `summary.untranslatedCount` rather than drawn as worth nothing.

```
total     = Σ holding baseMarketValue + max(cash, 0)
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

## 10a. Share adjustments (splits)

A split changes a share count with no transaction behind it. Stored separately and applied **in
front of** the replay engine, never by rewriting a transaction:

```
for every transaction on the instrument dated strictly BEFORE effectiveDate:
  quantity ← quantity × (numerator / denominator)
  price    ← price    ÷ (numerator / denominator)
  fee      ← fee                                     ← unchanged, always
```

`quantity × price` is preserved, so cost basis does not move and realized P&L on a pre-split sell is
unchanged. The fee is never touched: a commission was paid in cash, once.

A trade **on** the effective date is already quoted post-split, so the boundary is strict. Multiple
splits compound, oldest first.

**Precision.** A 3-for-1 split of a $10 purchase is $3.333333 a share in any fixed-decimal
representation, so total cost is preserved to within one unit of `MONEY_SCALE` per share rather than
exactly. The bound is pinned by a test. Most real ratios divide exactly.

**Fractions are kept, never rounded away.** A reverse split leaving 12.5 shares leaves 12.5 shares;
the cash in lieu a broker paid is a transaction the user records.

Deleting the adjustment restores every figure exactly — which is why this representation was chosen
over rewriting history or synthesising a trade. See [`docs/reconciliation.md`](reconciliation.md).

---

## 11. Snapshots

Portfolio **value** over time cannot be derived from transactions — it needs a market price for every
past day, which a free provider tier cannot supply. So value history accumulates forward, one row per
portfolio per day, written when the analytics page renders (the quotes were already fetched).
`unique (portfolio_id, snapshot_date)` makes a reload refresh the row rather than duplicate it.

A snapshot records the base currency it was taken in, and the chart reads only the rows matching the
portfolio's current one — a series mixing two currencies would show a cliff on the day the setting
changed and call it performance.

A snapshot is **skipped** when market data failed, any holding is stale, or any holding could not be
translated into the base currency, so a fallback or incomplete valuation is
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
