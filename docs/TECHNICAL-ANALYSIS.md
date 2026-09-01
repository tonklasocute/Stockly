# Technical analysis, indicators and the screener

What Stockly computes, how, and what it deliberately does not claim.

> Technical indicators are analytical tools describing past price and volume. They do not predict
> future performance and are not investment advice. Nothing in this system produces a buy or sell
> recommendation, and the vocabulary has no word for one.

---

## 1. Layers

```
Market data provider          OHLCV candles
        ↓
domain/indicators.ts          SMA EMA RSI MACD Bollinger ATR ADX volume — pure maths
        ↓
domain/technical.ts           trend, stage, signals, explainable score
        ↓
technical_snapshots (cache)   one row per symbol, refreshed on a schedule
        ↓
domain/screener.ts            structured filters over snapshots
        ↓
Stock detail · Screener · Watchlist · Alert engine
```

Everything above the cache line is pure: no provider, no database, no clock. That is what makes
`RSI` testable against Wilder's published worked example rather than against a screenshot.

---

## 2. Indicators

| Indicator | Definition | Default |
|---|---|---|
| SMA | arithmetic mean of the last *n* closes | 20, 50, 100, 200 |
| EMA | α = 2/(n+1), **seeded with the SMA of the first *n*** | 9, 20, 50, 100, 150, 200 |
| RSI | Wilder: RS = smoothed gain / smoothed loss, RSI = 100 − 100/(1+RS) | 14 |
| MACD | EMA(12) − EMA(26); signal = EMA(9) of that; histogram = difference | 12/26/9 |
| Bollinger | SMA(20) ± 2 **population** standard deviations | 20, 2σ |
| ATR | Wilder-smoothed true range | 14 |
| ADX | Wilder: ±DI from ±DM over smoothed TR; ADX = smoothed DX | 14 |
| Relative volume | today ÷ mean of the **previous** *n* sessions | 20 |

Three choices that reference implementations disagree on, fixed here:

- **The EMA seed is the SMA of the first period**, not the first close. Seeding from one arbitrary
  bar makes the next few hundred values differ from every charting package.
- **Bollinger uses the population standard deviation** (÷n). The sample form (÷n−1) widens every
  band slightly and would never quite match.
- **Relative volume excludes the current bar from its own average.** Including it damps exactly the
  spike the measure exists to find — a genuine 5× day reads as 4.2× on a 20-day window.

### Alignment and nulls

Every indicator returns an array **the same length as its input**, with `null` for the warm-up
period. That is load-bearing: crossing detection compares index *i* against *i−1* across two
different indicators, and dropping warm-up values would shift them apart.

`null` means "not computable here", never 0. An RSI of 0 is a real, extreme reading.

---

## 3. Data quality

Providers return imperfect series. Before anything is computed, `cleanSeries` drops or flags:

| Problem | Action |
|---|---|
| duplicate timestamp | dropped |
| high < low, or a close outside the range | dropped |
| non-positive price | dropped |
| out-of-order bars | sorted, and flagged |
| zero volume | **kept** — an untraded session is information — and flagged |

Whatever it found is reported on the stock page rather than swallowed. A number computed from bad
data looks exactly as authoritative as one computed from good data, which is the danger.

**Corporate actions:** the provider is asked for its adjusted series, so splits and dividends do not
appear as gaps. If a provider returned unadjusted prices, a 4:1 split would read as a −75% day and
poison every average for months — worth knowing when swapping providers.

**Market sessions:** the daily series contains trading days only, because that is what the provider
returns. Nothing here manufactures a weekend bar.

---

## 4. Trend, stage, signals

**Trend** — the documented rule, nothing more:

```
bullish   price > EMA50 AND EMA50 > EMA200
bearish   price < EMA50 AND EMA50 < EMA200
neutral   everything else, including any case where an EMA is undefined
```

A stock above its 50 but below its 200 is *mixed*, and saying so is more useful than forcing it into
a direction.

**Market stage** — a heuristic label after Weinstein, based on price relative to the 200 average and
that average's slope over 20 bars. `uptrend`, `downtrend`, `accumulation`, `distribution`,
`unknown`. **A description of the chart, not a forecast of the market.**

**Signals** are conditions that are measurably true right now — `PRICE_ABOVE_EMA200`,
`MACD_BEARISH`, `VOLUME_SPIKE`. The vocabulary contains no action word; a test asserts that none of
them ever matches `/BUY|SELL|TARGET|GUARANTEE/`.

---

## 5. The technical score

0–100, five weighted components, **every one carrying the sentence that produced it**:

| Component | Max | Awarded for |
|---|---|---|
| Trend | 25 | price above the 200 (10), above the 50 (8), 50 above 200 (7) |
| Momentum | 25 | MACD above signal (10), MACD above zero (5), RSI band (10/5/0) |
| Structure | 20 | ADX ≥40 (12) / ≥25 (9) / ≥20 (4); +DI above −DI (8) |
| Volume | 20 | relative volume ≥2× (20) / ≥1.5× (14) / ≥1 (10) / below (4) |
| Volatility | 10 | ATR ≤2% of price (10) / ≤4% (6) / above (2) |

The score is `earned ÷ possible × 100` **over the components that could be computed**, so a stock
with too little history for an ADX is scored on what is known rather than penalised for what is not.

Every threshold is a named constant in `THRESHOLDS`. There is no `if (rsi < 27.38)` anywhere.

`SCORE_VERSION` is stored with each snapshot, so a stored 62 remains interpretable after the weights
change.

The UI shows the arithmetic. A real example, verifiable by adding it up:

```
Trend       25/25  price above the 200 EMA, above the 50 EMA, 50 above 200
Momentum     5/25  MACD above zero, RSI weak
Structure   12/20  ADX above 40
Volume      10/20  volume around its average
Volatility  10/10  ATR 1.3% of price, steady
            62/100 → 62
```

---

## 6. The screener

### Security: no expression ever reaches the server

A filter is three constrained values:

```json
{ "metric": "RSI", "operator": "LT", "value": 30 }
```

`metric` and `operator` are closed enums, validated by Zod at the boundary and looked up in a table
in the engine. There is no field a client can put SQL, JavaScript or a query fragment into, because
there is no field that is ever interpreted. An unknown metric does not error interestingly — it
reads as `null` and matches nothing.

Saved screens store the same structured JSON, and the table has a check constraint on its shape.

### Operators

`GT` `GTE` `LT` `LTE` `EQ`, plus `CROSS_ABOVE` / `CROSS_BELOW` for the two metrics that track a
crossing. That distinction is the same one the alert engine makes: "MACD histogram > 0" is true for
as long as the trend lasts; "MACD crossed above" is a fact about the last bar.

Filters combine with `AND` or `OR`, capped at ten.

### The universe — the honest ceiling

**Phase 6 screens the stocks this deployment already tracks**, not the whole market: everything held,
watched or alerted on, plus a default list of sixteen, capped at 60 symbols.

That is a consequence of the data source, not a design preference. Indicators need an OHLCV history,
which is one request per symbol with no batching, and the free tier allows eight a minute. Scanning
five thousand names is not slow — it is ten hours and twenty times the daily quota.

`ponytail:` ceiling — a market-wide screener needs a provider with a bulk endpoint (a daily snapshot
file, or a screener API). Only `resolveUniverse` changes; everything downstream already works from a
list of symbols.

### Performance

Running a screen costs **zero upstream requests**. Snapshots are computed by the scheduled job and
read from the database, so a user pressing Run repeatedly costs a query. Prices for the returned
page — 25 symbols, not the universe — come from one batched quote call afterwards, and the two
timestamps are labelled separately: a stale indicator is never presented as a live one.

Measured on the pure path: 10,000 snapshots filtered and sorted in well under a second, scaling
linearly.

---

## 7. Technical alerts

They reuse the phase 5 engine completely — same crossing rule, same `armed → triggered` state
machine, same cooldown, same idempotency key, same notification service. **No second engine.**

| Type | Reads |
|---|---|
| `RSI_ABOVE` / `RSI_BELOW` | RSI(14) |
| `ADX_ABOVE` | ADX(14) |
| `RELATIVE_VOLUME_ABOVE` | relative volume |
| `PRICE_ABOVE_EMA` / `PRICE_BELOW_EMA` | price distance from the 200 EMA, in percent |
| `MACD_BULLISH_CROSS` / `_BEARISH_CROSS` | the cross itself |
| `EMA_CROSS_BULLISH` / `_BEARISH` | the 50/200 cross itself |

The cross types are the neat part: their reading is **1 on the bar the cross happened and 0
otherwise**, against a target of 0.5. The engine's ordinary crossing rule then fires exactly once per
event, with no special case anywhere.

Readings come from the cached snapshot, whose `calculated_at` feeds the engine's existing staleness
guard — so a technical alert refuses to fire on an old snapshot for the same reason a price alert
refuses to fire on an old quote.

---

## 8. Freshness

Two timestamps, never conflated:

- `source_timestamp` — the bar the indicators describe
- `calculated_at` — when they were computed

Beyond 90 minutes a snapshot is **shown as delayed**, in the stock page and in the screener results.
The stock page states it outright: the price above is live, these indicators are not.

---

## 9. What is deliberately absent

No price prediction, no machine learning, no signal scoring that implies an action, no automated
trading, no "early buy score". Phase 6 measures what has happened. Anything that claims to know what
happens next is a different product, and would need a different set of promises.
