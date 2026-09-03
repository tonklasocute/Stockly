# Historical Rebuild (Phase 16)

What can be rebuilt, what cannot, and the procedure for each.

---

## 1. The asymmetry everything here follows from

| Derived from | Rebuildable? |
|---|---|
| Transactions — quantity, cost basis, invested capital, realised P&L, cash, flows, fees | **Always, exactly.** Replay them. |
| A market price on a past date | **No.** It happened once and was not stored. |
| An exchange rate on a past date | **No**, before `fx_rates_daily` began filling. |

Everything in the first row is recomputed on every request by `domain/history.ts`, which filters the
transaction set by date and hands it to the *same* `replayPortfolio` and `computeCash` the dashboard
uses. There is no historical cost-basis formula and no stored past state — which is why correcting a
transaction from March corrects every figure about March, and why a reconstruction can never
disagree with the live engine. `domain/history-invariants.test.ts` asserts both.

The second and third rows are why `portfolio_snapshots` exists at all. It holds the one thing that
cannot be recovered.

## 2. Rebuilding derived analytics

There is nothing to rebuild. Returns, contributions, drawdowns, monthly tables, turnover and fee
ratios are all computed on read and none is stored. A change to a transaction takes effect on the
next page load.

This is a deliberate trade: it costs a recomputation per request and buys the impossibility of a
stale analytic. `loadHistory` is `cache()`d so a page and every section on it share one pass, and it
makes **no upstream call** — everything historical is rows already in the database.

## 3. Rebuilding a snapshot

A snapshot is a *reading*, not a derivation, so "rebuilding" one means taking a new reading for a
date — and for a past date, the price that would make it accurate no longer exists.

**Deleting a snapshot is safe and reversible in one direction only.** It removes a point from the
history and touches nothing else — no transaction, no holding, no P&L. It cannot be undone, because
the price is gone.

```sql
-- Inspect before removing anything.
select snapshot_date, total_value, quality, missing_holdings, source, calculation_version
  from public.portfolio_snapshots
 where portfolio_id = '<id>'
 order by snapshot_date desc
 limit 30;

-- Remove a range known to be wrong. The history gains a gap; it loses no money.
delete from public.portfolio_snapshots
 where portfolio_id = '<id>' and snapshot_date between '2026-03-01' and '2026-03-31';
```

Today's snapshot *can* be rebuilt accurately: open the analytics page, which upserts on
`(portfolio_id, snapshot_date)`.

### Quality, not absence

Before phase 16 an incomplete day was **refused**, which left a hole — and a hole is
indistinguishable from a day the portfolio was not held. Now the reading is recorded with its
quality (`COMPLETE`, `PARTIAL`, `STALE`) and, when partial, the count of what is missing from it. A
check constraint forces the two to agree, so a `COMPLETE` row can never claim to be missing
something.

The one thing still refused is a day priced entirely from fallback: that is not a partial reading of
the market, it is cost basis wearing a price's clothes.

## 4. Backfilling market history

**Not implemented, and the shape it would take matters.**

Stockly stores no per-holding price history, which is the limitation
`docs/performance-attribution.md` §6 measures with the attribution residual. Closing it means daily
closes per held instrument, which is a real feature with a real cost: one provider call per symbol
per range, against a free tier of 8 credits a minute and 800 a day.

Any such job must be:

- **Bounded** — a hard symbol and date cap per invocation, never "every symbol, all history".
- **Resumable** — a cursor, so a run that hits a rate limit continues rather than restarts.
- **Idempotent** — keyed on `(symbol, market, date)`, so a re-run upserts.
- **Rate-limit aware** — the provider's per-minute window respected, not merely retried into.
- **Observable** — counters into `job_executions`, as every other job here is.

A single user request must never be able to trigger unbounded upstream work. The existing jobs are
the pattern: `MAX_REFRESH_SYMBOLS`, `MAX_SNAPSHOT_PORTFOLIOS`, `maxDuration = 60`.

## 5. Backfilling FX history

`fx_rates_daily` starts empty and fills forward. Backfilling it from a provider time series is
possible where one is offered, under the same five rules as §4.

**It is not interpolation.** Filling a gap between two observed rates by averaging them produces a
fabricated observation, and `docs/fx-attribution.md` §6 forbids it. A date with no rate stays a date
with no rate, and the period containing it reports N/A.

## 6. Calculation versioning

Every snapshot carries `calculation_version`. It is bumped when a calculation changes **meaning** —
not when it is refactored.

The purpose is to make disagreement visible rather than silent. A row written by version 1 and read
by version 2 can be identified as such, so the choice between reinterpreting it and discarding it is
made deliberately. Without it, a change to how a total is computed would quietly reinterpret years
of history under rules that did not exist when it was recorded.

Procedure for a meaning-changing calculation:

1. Bump `CALCULATION_VERSION` in `features/analytics/portfolio-analytics.ts`.
2. Decide, and write down in the migration, what happens to older rows: kept and labelled, or
   deleted for re-reading. **Never silently reinterpreted.**
3. If they are kept, the UI must be able to say which version produced a point.

## 7. What must never be rebuilt

**Transactions.** They are the source of truth; everything else is a view of them. There is no job,
script or endpoint in this codebase that recomputes, corrects or regenerates a transaction, and
adding one would invert the architecture.

The invariant suite states it as a test: after every historical operation the phase added, the
transaction set is byte-identical and holdings, cost basis, P&L and cash are unchanged.

## 8. Rollback

The migration is additive — four columns on an existing table and one new table — so application
code can roll back without touching the schema.

Rolling back the *code* leaves the new columns populated and ignored, which is harmless: they have
defaults, and phase 15's write path still compiles against them.

Rolling back the *data* is a delete of `fx_rates_daily` (reference data; refetchable going forward)
and, if required, of snapshot rows written by the scheduled job:

```sql
delete from public.portfolio_snapshots where source = 'SCHEDULED';
```

That removes readings, never money. No sharing, import or intelligence table references any of them.
