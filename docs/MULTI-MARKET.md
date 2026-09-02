# Multi-market and multi-currency (phase 9)

Phase 1–8 assumed one market and one currency: US stocks, priced in dollars, in a portfolio kept in
dollars. Nothing in the codebase said so out loud — it was implicit in a hundred places, which is
what made it dangerous. Phase 9 makes it explicit and then makes it configurable.

The result is a system where **US and SET are two rows in a registry**, and adding Tokyo is a third
row plus an adapter, not a rewrite.

---

## 1. The four ideas

### An instrument has a market, and a market has a currency

`domain/market.ts` is the registry. A market carries its currency, timezone, exchanges, trading
sessions, holidays and symbol grammar. Everything downstream reads those fields rather than
inspecting a symbol:

```ts
currencyOf("SET")            // "THB"
marketOf("US").timeZone      // "America/New_York"
instrumentOf("PTT", "SET")   // { symbol, market, currency, exchange, assetType }
```

`if (symbol === "PTT")` is the shape this file exists to prevent. So is
`if (market === "TH") …` scattered through the application: market-specific behaviour lives behind
the registry, or behind the provider router, and nowhere else.

**Currency is derived from the market, not stored beside it.** Storing both would let
`market = 'US', currency = 'THB'` exist, and the first time they disagreed every number computed
from them would be wrong in a way nothing could detect. Cash and dividends are the exceptions and
they are deliberate: a portfolio can genuinely hold two cash balances, and a listing can pay in a
currency other than the one it trades in. Those are stored, because they are not derivable.

### A portfolio has a base currency

`portfolios.currency` — which has existed since the first migration — is now formally the **base
currency**: the one every total, chart and summary on that portfolio's pages is denominated in.
Holdings keep their own currency; the base currency is only what they are *translated into*.

Existing portfolios are USD, which is what they always were. Nothing about them changes.

### Native figures are exact; base-currency figures are a translation

This split runs through the whole type system, and reading it correctly is most of understanding
phase 9:

| Field | Currency | Nullable? |
|---|---|---|
| `Holding.currentPrice`, `marketValue`, `unrealizedPnl`, `todayPnl` | the **instrument's** | no |
| `Holding.baseMarketValue`, `baseInvestedValue`, `baseUnrealizedPnl`, … | the **portfolio's** | **yes** |
| `Holding.returnPct`, `todayReturnPct` | neither — a ratio | not for FX reasons |
| `Holding.weight` | neither — a ratio in base currency | **yes** |
| `PortfolioSummary.*` | the **portfolio's** | no, but incomplete — see `untranslatedCount` |

NVDA is quoted in dollars whether or not you keep your portfolio in baht. `returnPct` is a ratio of
two same-currency figures, so no rate can move it — which is also why a stock's *performance* is
never contaminated by a currency's.

### Missing FX is `null`, never `0` and never `1`

A conversion that cannot be done honestly is an unknown, and it renders "N/A". Defaulting to 1 would
value a ฿32 stock at $32; defaulting to 0 would erase a real position from a real total.

The consequence is that `PortfolioSummary` totals **can be incomplete**, and say so:

- `untranslatedCount` — holdings left out of every total because no rate reached the base currency.
- `fxStaleCount` — holdings translated at a rate over an hour old.
- `exposures[].baseValue` — null for a currency that could not be translated.

`CurrencyNotice` turns those into a sentence on the page. A total that had to leave something out
must say what it left out.

---

## 2. Data flow

```
transactions (symbol, market, quantity, price, fee)
        |
        |  replayPortfolio — keyed by (market, symbol), currency-blind by construction:
        |  every trade of one instrument is in that instrument's currency, so no rate is involved
        v
positions / realized trades          [native currency]
        |
        |  priceHoldings — one batched quote call PER MARKET
        v
holdings with native marketValue     [native currency]
        |
        |  convert() — one FX rate per currency pair, today's rate, reported alongside
        v
holdings with baseMarketValue        [base currency]   ... or null
        |
        v
summarize / allocation / analytics   [base currency]
```

Two rules keep this honest:

1. **The replay never sees an exchange rate.** Cost basis is averaged across trades of one
   instrument, all in one currency. A stored row's numbers can therefore never move because a rate
   did — which is the thing the phase brief was most emphatic about.
2. **Conversion happens once per holding**, and the rate applied is the rate reported to the user.
   Asking the converter five times could not give five answers, but doing it once means the rate
   shown is provably the rate used.

### Where the rate is applied downstream

Fees, invested-capital history and realized-trade statistics all sum money across rows, and a sum
mixing baht with dollars is not money in any currency. Rather than teach each function about
exchange rates, `translateTransactions` and `translateTrades` in `domain/analytics.ts` restate the
rows **once**, in the base currency, before the statistics see them. The statistics stay the plain
arithmetic they were, and there is exactly one place a rate is applied.

Rows that cannot be translated are dropped rather than counted at a made-up rate — reachable only
when the FX provider has no rate for a pair, and signalled portfolio-wide by `untranslatedCount`.

---

## 3. FX gain/loss is `null`, deliberately

`PortfolioSummary.fxEffect` is typed `null`. Not "null for now" — `null` as the type.

Separating currency movement from stock performance needs the exchange rate on **every past trade
date**, and Stockly stores none. A number computed without them would be a guess wearing an
analytic's clothes, which is precisely what the null-over-zero rule exists to prevent.

What *is* shown instead: every converted figure carries its rate and the rate's timestamp
(`FxNote`), and any page whose totals crossed a currency boundary carries `TranslationNote` — one
line saying these figures are a translation at today's rate.

To build a real FX attribution later you would need a `fx_rates` table with a daily close per pair,
populated from the first trade date forward, and `replayPortfolio` would have to carry a
base-currency cost basis alongside the native one. That is a phase, not a patch.

---

## 4. Market data routing

`services/market-data/index.ts` is the only place that knows which provider serves which market.

```ts
getMarketDataProvider("SET")   // the adapter configured for SET, or a MarketDataError
getQuotesFor(instruments)      // grouped by market: ONE batched call per market
getMarketStatuses()            // per market; a failure is "unknown", never a guess
searchInstruments(q, market?)  // de-duplicated by provider, results tagged with their venue
```

- `MarketDataProvider.markets` declares what an adapter can price. The router refuses to send it
  anything else, rather than letting a US endpoint answer a SET symbol with a plausible-looking
  wrong price.
- A market whose provider fails contributes nothing and is named in `failed`. **The others still
  return** — a Thai outage must not blank out a US portfolio.
- Quotes are keyed by `symbolKey` (`"SET:PTT"`) everywhere, because a bare symbol is unique only
  within one market. So are technical snapshots, alert readings and position weights.

`MARKET_DATA_PROVIDER_SET` overrides the provider for SET alone, defaulting to the main one.

### Adding a market

1. A row in `MARKET_REGISTRY` (`domain/market.ts`): currency, timezone, sessions, exchanges,
   holidays, symbol grammar, `calendarVerifiedThrough`.
2. A row in `PROVIDER_MARKET` in whichever adapter will serve it — the provider-specific spelling of
   the venue lives there and nowhere else.
3. The `check (market in (…))` constraints in the migrations.
4. An FX pair, if its currency is new.

No domain function changes. That is the test of whether this abstraction earned its place.

---

## 5. FX provider

`services/fx/` mirrors `services/market-data/` exactly: an interface, a mock, a real adapter, and
one place that chooses.

```ts
interface FxRateProvider {
  getRate(base, quote): Promise<FxRate | null>
  getRates(pairs): Promise<FxRate[]>
}
```

**Every method resolves.** A pair the provider does not know is `null`; an outage is `null` too. FX
is a translation layered on top of a portfolio that already works, so a provider being down degrades
a figure to "N/A" and never throws a page away.

`FX_PROVIDER` defaults to `MARKET_DATA_PROVIDER` — the same account on the same rate limit, and
running live prices against mock rates is never what anyone meant. An **unrecognised** value selects
a provider that knows no rates at all, deliberately not the mock: fabricated rates in production
would sit where a portfolio total goes.

### Caching, and why ten holdings are not ten requests

`loadFxTable(base, currencies)` asks for `base → …others` and nothing else. Two layers of caching sit
under it:

- `cache()` deduplicates within a render — a dashboard's summary, allocation chart and holdings
  table share one table.
- The adapter goes through `fetchJson`, so the Next Data Cache holds each pair for **10 minutes**,
  shared across serverless instances.

A fifty-holding portfolio spanning two currencies costs **one** FX request per ten minutes, for the
whole deployment. A single-currency portfolio costs none: the identity conversion consults nobody.

---

## 6. Market calendars

`domain/calendar.ts` answers "is this market open?" in the market's own timezone, via `Intl`. The
browser's clock is never the source of truth — a user in Bangkok looking at NVDA needs New York's
clock and New York's holidays.

```ts
marketSessionStatus("SET", at)   // "open" | "pre" | "post" | "closed" | "unknown"
isTradingDay("US", "2026-09-07") // false — Labor Day
nextTradingDay("US", "2026-09-04")
```

Three things worth knowing:

- **The provider's reported status always wins.** A calendar is a prediction about an exchange's
  behaviour; the exchange's own answer is a fact. The calendar fills the gap when there is none.
- **`"unknown"` is a real answer.** Past `calendarVerifiedThrough` a weekday returns "unknown", never
  "open" — an unlisted holiday is exactly the case that would otherwise make Stockly claim a shut
  exchange was trading. Weekends stay knowable forever.
- **SET's table is incomplete on purpose.** The fixed-date national holidays are listed; the Buddhist
  holidays that move with the lunar calendar are not, because this file cannot compute them. That is
  why `calendarVerifiedThrough` for SET is only the end of 2026 — refresh both the list and the date
  from SET's published calendar each December.

SET's two sessions (10:00–12:30, 14:30–16:30 Bangkok) are modelled as two windows; the midday break
is not a trading window. US half-days are deliberately not modelled: the market *is* open on those
days, and a wrong closing time costs a label while a wrong open/closed costs an alert.

---

## 7. What stays in native currency, and why

**Technical analysis.** Indicators are computed from the instrument's own price series, always. An
RSI is a shape in a price history; converting the series into the portfolio's currency first would
fold the exchange rate's movement into the indicator and produce a number describing two things at
once. `NVDA`'s RSI is the same whether your portfolio is in dollars or baht — as it must be, since
the snapshot table is shared reference data across all users.

**The screener.** A market scope narrows the *universe* before any threshold is applied; it changes
no reading on any instrument. Screener rows carry their own `currency` for the price column, and
nothing else on the row depends on a currency at all.

**Price alerts.** A target is set in the currency the instrument is quoted in — a PTT alert is in
baht — which is why `alerts.market` decides both the provider and the currency of `target_value`.
The session guard is per market: New York being shut says nothing about Bangkok.

**Portfolio alerts** are the mirror image: daily change, total return and position weight are
computed from the portfolio's own base-currency summary, so they never compare a dollar figure
against a baht one.

---

## 8. Snapshots and a change of base currency

`portfolio_snapshots` is the only figure Stockly cannot recompute: portfolio value on a past day
needs a market price for that day, which the provider's free tier cannot supply. Every row is
therefore a permanent record, denominated in whatever the base currency was when it was written.

That makes changing a portfolio's base currency dangerous in a way nothing else is. A dollar row
plotted beside a baht row puts a thirty-two-fold cliff in the performance chart on the day the
setting changed, and labels it performance.

Two rules close it:

- Each snapshot **records its currency** (`portfolio_snapshots.currency`, added by this phase's
  migration, defaulting to `'USD'` — exact for every existing row, since USD was the only base
  currency the app supported).
- The chart reads **only the rows matching the portfolio's current base currency**. Switching starts a
  fresh series; the old rows are kept rather than deleted, because they are still true about the
  currency they were taken in.

A snapshot is also **skipped entirely** when any holding could not be translated
(`untranslatedCount > 0`), for the same reason it is skipped when a quote is stale: a total that
silently excluded a position would become a permanent dip with nothing left to explain it.

---

## 9. Backward compatibility

Nothing about a US/USD portfolio changes.

- `transactions.market` has defaulted to `'US'` since the first migration; a row with no market is
  read as US, exactly as the column says.
- `portfolios.currency` has defaulted to `'USD'` since the first migration.
- With base currency USD and every holding in USD, every conversion is the **identity**: rate 1, no
  provider consulted, `baseMarketValue === marketValue`. The engine produces byte-identical numbers,
  and `domain/holdings-currency.test.ts` asserts exactly that.
- `buildPortfolio(transactions, quote)` with no options behaves as it did before phase 9.

The migration (`20260902000000_multi_market.sql`) adds **no columns**. Every column this phase needs
already existed; what it adds are the `check` constraints that were previously only enforced in
TypeScript, plus one widened index. It is additive and forward-only, so code can roll back without
touching the schema.

---

## 10. Deliberately not here

- **Historical FX rates**, and therefore FX attribution. See §3.
- **Triangulated rates.** A EUR→THB rate synthesised from two others is a number no provider would
  stand behind. `findRate` inverts a pair but will not triangulate; the honest answer is `null` until
  a provider is asked for that pair directly.
- **More than one currency per market.** A venue quoting the same instrument in two currencies
  (HKEX's dual-counter model) needs `currency` on the instrument rather than on the market. Every
  caller already reads it through `currencyOf`/`instrument.currency`, so that is a file and a
  migration, not a redesign.
- **SET in the default screener universe.** Every symbol there costs an OHLCV request per refresh
  cycle; seeding Thai names for an account that holds none would spend a scarce quota on data nobody
  asked for. SET symbols enter the universe the moment a user holds, watches or alerts on one.
- **A dedicated FX-rate history view.** The settings page's Data health panel reports the current
  rate, its age and its freshness per pair, which is what an operator or a suspicious user needs.
  A chart of a rate over time is a market-data feature, not a portfolio one.
