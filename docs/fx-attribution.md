# FX Attribution (Phase 16)

Why currency attribution reports **N/A**, what would have to exist for it not to, and what phase 16
put in place towards that.

---

## 1. The short version

`AttributionResult.fxGain` is typed `null`. Not "null when unavailable" — **always null**, enforced
by the type.

Separating currency movement from asset performance requires an exchange rate for **every day of
the period being measured**. Stockly has never stored one. `domain/fx.ts` fetches today's rate and
caches it for ten minutes; there has been no historical FX table since phase 9, which is exactly why
`PortfolioSummary.fxEffect` has been typed `null` since then with the same explanation.

Producing a number anyway would mean interpolating rates nobody observed and presenting the result
as an analytic. That is the single most dangerous thing this codebase could do, because an FX
attribution is *unfalsifiable to its reader*: nobody checks it, and it looks authoritative.

## 2. What the calculation would be

For a holding in a foreign currency, over a period, the return in the base currency decomposes as:

```
(1 + r_base) = (1 + r_asset) × (1 + r_fx)

r_asset = the return in the instrument's own currency
r_fx    = the movement of that currency against the base
```

so the currency contribution to the base-currency return is:

```
fxContribution = (1 + r_asset) × (1 + r_fx) − (1 + r_asset)
               = (1 + r_asset) × r_fx
```

The cross-term `r_asset × r_fx` is real, not a rounding artefact, and is why the two effects cannot
simply be added.

### A concrete case

A THB-denominated holding, in a portfolio kept in USD:

- the stock rises 10% in baht
- the baht weakens 8% against the dollar

The naive reading is "+10%, roughly +2% after currency". The correct answer is
`1.10 × 0.92 − 1 = +1.2%`. Reporting either the 10% or a hand-waved 2% would be wrong, and the
second would be wrong while looking careful.

## 3. What each period needs

| Requirement | Status |
|---|---|
| A rate for the pair on the period's **start** date | ❌ not stored before phase 16 |
| A rate on the period's **end** date | ✅ today's, from the live provider |
| A rate on **every trade date** inside the period | ❌ not stored |
| A rate on **every dividend date** | ❌ not stored |
| Which currency each cash flow crossed, and when | ✅ `cash_transactions.currency` |

Three of the five are missing, and they are the three that matter most: a mid-period purchase at an
unknown rate makes every subsequent day's decomposition unrecoverable.

## 4. What phase 16 added

`fx_rates_daily` — `(base, quote, rate_date) → rate`, with a source and a created timestamp.

It is deliberately **empty on deployment**. Shared reference data, readable by any signed-in user,
writable by nobody through a request: RLS has a select policy and no insert, update or delete
policy at all, so only the service-role scheduled job can fill it.

Constraints that matter:

- `rate > 0` — a rate is a ratio of two prices. Zero and negative are not slightly wrong, they are
  impossible, and accepting one would value a portfolio at nothing.
- `rate_date <= today` — a rate cannot be recorded for a day that has not happened.
- `base <> quote`, both from the known currency set.
- Primary key on the pair and date, which makes any filling job **idempotent** by construction.

## 5. What this does and does not unlock

**It does not make FX attribution retroactively available.** A period that predates the first stored
rate has no rates, and the engine will keep returning `null` for it. Backfilling from a provider
time series is possible where one exists — `docs/historical-rebuild.md` §5 describes the bounded,
resumable job — but a rate that was never fetched is not a rate, and interpolating between two
observed rates to fill a gap is a fabricated observation, not a recovered one.

**It does begin the record.** Once the table has covered a period end to end, the decomposition in
§2 becomes computable for that period, and the engine gains a real value where it currently returns
null. That is a follow-on change with its own tests, not something to switch on quietly.

## 6. Rules for whoever implements it

1. **Never interpolate a missing rate.** A gap makes the period unavailable. The whole point of
   `fx_rates_daily` is that a stored rate is one that was actually observed.
2. **Never fall back to today's rate for a past date.** A rate of "the current one" applied to March
   values March at June's prices and calls the difference performance.
3. **Report the cross-term.** `r_asset + r_fx` is not the return; §2 has the arithmetic.
4. **A stale rate is not a missing rate, and neither is zero.** Both get their own state, as
   `domain/freshness.ts` already models for live rates.
5. **Keep the asset return in the instrument's own currency.** Converting the series first folds the
   exchange rate into the very number the decomposition is trying to isolate — the same rule
   `docs/MULTI-MARKET.md` already applies to technical indicators.
6. **A single-currency portfolio has no FX component**, and should say so rather than reporting 0%.
   Zero implies a currency effect was measured and found to be nil.

## 7. What is reported today

The attribution panel shows a **From currency** tile reading `N/A`, with the sentence:

> Separating currency movement from asset performance needs an exchange rate for every day of the
> period, and Stockly does not store one for all of them.

The tile is present rather than hidden on purpose. An absent tile suggests currency does not matter
to this portfolio; a tile reading N/A says it matters and has not been measured — which is the true
statement.
