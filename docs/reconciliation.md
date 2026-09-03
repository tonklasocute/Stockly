# Reconciliation, adjustments and the audit trail

Phase 19. How Stockly checks its records against a third party, and what it is allowed to do about
a disagreement.

## The one rule

```
External data → reconciliation → difference → human review → explicit adjustment → engine → figures
```

Every arrow in that chain exists in the code. The one that does **not** exist, anywhere, is:

```
External data → figures
```

A broker statement is a reading somebody else took, under settlement conventions Stockly does not
model, of an account it cannot see. It is excellent evidence and it is not authority. So the
comparison layer produces a *description* of a difference and stops, and the only things that can
still move a number are the tables that always could: `transactions`, `cash_transactions`,
`dividends`, plus — new in this phase — `share_adjustments`.

`domain/operations-invariants.test.ts` runs the whole comparison layer against a portfolio and
asserts every figure is byte-identical afterwards.

## What lives where

| Concern | Module | Writes? |
|---|---|---|
| Trade-level comparison | `domain/import/reconcile.ts` (phase 12) | no |
| Position and cash comparison | `domain/reconciliation.ts` | no |
| Split arithmetic | `domain/corporate-actions.ts` | no |
| Cash ledger and per-currency balances | `domain/cash.ts` | no |
| Running and recording a comparison | `features/operations/reconcile.ts` | runs + items only |
| Transfer preview | `features/operations/transfer.ts` | no |

`domain/reconciliation.ts` and `domain/corporate-actions.ts` import no client, no `fetch`, no
framework and no `server-only`. That is asserted by a test, because a module that structurally
cannot write is a stronger guarantee than one that merely does not.

## Positions

`reconcilePositions(brokerPositions, positions)` compares two readings keyed by `symbolKey` —
market included, because `PTT` in Bangkok and `PTT` in New York are different companies and matching
on the bare symbol would reconcile them into a satisfying zero.

Statuses: `MATCHED`, `QUANTITY_DIFFERS`, `COST_DIFFERS`, `MISSING_IN_STOCKLY`, `MISSING_IN_BROKER`,
`CURRENCY_MISMATCH`.

Three details that are load-bearing:

- **A missing side is `null`, not `0`.** A position the statement does not list has
  `brokerQuantity: null`. Zero means "no shares", which is a different claim.
- **An unreported average cost is `null`.** Plenty of statements omit it; a zero would report every
  such position as a 100% discrepancy.
- **A closed position is not a difference.** A position the user sold out of is absent from a
  broker's holdings page because it is absent.

### Candidate causes

Every difference carries a list of *candidates*, never a diagnosis. `SPLIT_RATIO` fires only when
the two counts differ by a clean ratio (2×, 3×, ½, …) — a 1.37× difference is just a different
number, and calling that a split would be a guess dressed as a finding.

No cause says anything is wrong, and a test enforces the vocabulary.

## Cash

`reconcileCash(brokerBalances, stocklyBalances)` compares **one currency at a time** and converts
nothing. This is why `computeCashByCurrency` exists: a statement reports a dollar balance and a baht
balance, never a translated total, so comparing against `analytics.cash` — which *is* translated —
would report today's exchange rate as a discrepancy.

There is deliberately no combined "total difference" figure. It would have to be denominated in
something, and any currency it were stated in would make it a function of today's rate.

## The cash ledger

Phase 3 shipped two kinds. Phase 19 has nine, and the line that matters is not the count:

| Capital flows | Outcomes |
|---|---|
| `deposit` `withdrawal` `transfer_in` `transfer_out` `adjustment_in` `adjustment_out` | `fee` `tax` `interest` |
| Money crossing the portfolio's boundary. Never a return. Removed from both sides of every performance figure. | Money the portfolio earned or was charged. Part of performance, and never contributed capital. |

Getting that wrong is how a deposit becomes a profit, or how a custody fee makes a portfolio look
like it was drawn down. `CASH_FLOW_DIRECTION` and `CAPITAL_FLOW_KINDS` in `domain/cash.ts` are the
single statement of both rules.

Phase 12 had **four** call sites written as `kind === "deposit" ? … : …`, each treating every other
kind as a withdrawal. Adding an enum value would have silently misclassified a fee as a withdrawal
in the IRR series, the TWR valuation points, the historical capital flows and the goal contribution
average. All four now read the shared table.

## Splits

A split is the only corporate action that changes a derived number with no transaction behind it.
Two hundred shares appear where a hundred were, and no money moved. Three representations exist and
only one is honest:

| | Cost |
|---|---|
| Rewrite the stored transactions | Destroys the record of what the user actually did |
| Record a buy for the new shares | Invents a purchase, a cost basis and a realized P&L |
| **Record it separately, apply it on replay** | Nothing is lost, and it is reversible |

`applyShareAdjustments` is a filter in front of `replayPortfolio`, the same shape as `reconstructAt`
in `domain/history.ts`. Quantity is multiplied by the ratio, price divided by it, and **the fee is
never touched** — a commission was paid in cash, once, and a split does not retroactively change
what it cost to trade.

Delete the `share_adjustments` row and every figure returns to exactly what it was.

### Precision

Total cost is preserved to the scale of the money type, not exactly. A 3-for-1 split of a $10
purchase is $3.333333 a share in any fixed-decimal representation, and no arrangement of the
arithmetic makes 3 × 3.333333 equal 10. The residue is bounded by one unit of `MONEY_SCALE` per
share, far below anything displayed, and the bound is pinned by a test so it cannot widen quietly.

Most real splits (2:1, 4:1, 1:10) divide exactly.

### Fractions

A reverse split can leave a fraction of a share. Stockly **keeps it and says so**. A broker settles
it as cash in lieu; rounding it away would delete shares the user owns, and the preview names the
leftover so they can record the cash-in-lieu sale if there was one.

### What is not adjustable

Mergers, acquisitions, rights offerings and tender offers all need cost basis **allocated** between
two instruments, or between an instrument and cash, using a ratio only the issuer publishes.
Stockly stores no such ratio. A basis invented to make a position balance flows into realized P&L
the moment the position is sold, and nothing downstream can tell it apart from a figure that was
actually earned — so these are listed for review with a sentence saying why, and the user records
the outcome as ordinary transactions.

`UNADJUSTABLE_REASON` carries those sentences, and a test asserts none of them recommends an action.

## Transfers

**A transfer re-parents transactions.** `transfer_instrument` runs one `update … set portfolio_id`.

Quantity, cost basis, acquisition dates, fees, currency and market are preserved because the rows
are the same rows. There is nothing to recompute, so there is nothing to drift, and — the point —
**no profit or loss is realized, because nothing is sold.** A synthesised sell-and-buy pair would
book a gain nobody made.

An instrument moves with its whole history or not at all: moving only the open shares would split
one weighted-average cost basis across two portfolios and leave the realized P&L of past sells
attached to the wrong one.

**Known limitation.** An import fingerprint contains the portfolio id it was created under, and a
transfer does not rewrite it. Re-importing the same statement into the *destination* portfolio will
therefore create new rows rather than deduplicate. Rewriting the key would break the audit link
between a transaction and the import that produced it, which is the worse trade; reconciliation
surfaces the duplicates, which is what it is for.

## Corrections and the audit trail

`financial_audit` records the row **before** and **after** every insert, update and delete on
`transactions` and `cash_transactions`. Two properties make it an audit trail rather than a log:

- **A trigger writes it**, so every path produces a row — the API, an import, a correction, a
  transfer, a psql session — and no future endpoint can forget to.
- **Nobody can change it.** The table has a select policy and no insert, update or delete policy.
  RLS denies what it does not permit, so the *absence* of those three policies is the protection;
  the trigger writes through `security definer` and does not need one.

It stores the two states rather than a diff. A diff is an interpretation; what an auditor needs is
what it was and what it became.

### Why corrections have their own endpoint

An ordinary `PATCH` is already audited. What it cannot carry is *why*: PostgREST sends each request
as its own transaction, so a reason set by a separate call would never reach the trigger.
`correct_transaction` performs the update itself, which puts the reason and the change in the same
transaction via `set_config('stockly.audit_reason', …, true)`.

That function is `security definer`, so RLS does not apply inside it and its `user_id = auth.uid()`
predicate **is** the ownership boundary. Same for `transfer_instrument`, which checks both
portfolios. `supabase/operations-policies.test.ts` asserts both predicates are present — they are
the IDOR test.

## Privacy

Reconciliation is more private than the portfolio it reconciles. A holdings list says what somebody
owns; a reconciliation says which broker they use, what their cash balance is in each currency, and
which of their own records they got wrong. An audit trail is the history of every correction they
have ever made.

There is no switch to publish any of it. `ShareSource` declares no field for a reconciliation, an
audit row, an adjustment or a per-currency balance, so `projectPublicPortfolio` cannot carry one —
it is never handed one. `features/operations/privacy.test.ts` proves it by projection under every
preset and with every switch on at once, and by reading `domain/sharing.ts`.

The anonymous role's entire grant in the schema is still one `select` on `published_shares`.

## Data quality

Three rules join the phase 12 scan:

- `RECONCILIATION_UNRESOLVED` — findings nobody has looked at. **WARNING**, and the wording is
  careful: a difference is not proof Stockly is wrong, only that two records disagree.
- `RECONCILIATION_STALE` — last reconciled more than `staleReconciliationDays` (92) ago. **NOTICE**,
  because a reminder is not a finding.
- `RECONCILIATION_NEVER_RUN` — **INFO**, and only for a portfolio that has transactions.

`daysSinceReconciliation` is `null` when there has never been a completed run, and null is not zero:
"never reconciled" and "reconciled today" are opposite states. A run still `PROCESSING` or `FAILED`
does not count as having happened, which is what makes a stuck run visible.

## Operational notes

- A run is written as `PROCESSING` **before** the comparison, so a crash leaves it visibly stuck
  rather than leaving no trace. A row written only on success cannot report a failure.
- `COMPLETED_WITH_WARNINGS` exists so a run that found differences is not reported as clean, and
  `FAILED` requires an `error` by check constraint so it can never be an empty success.
- A run reads `loadAnalytics`, the same cached pass the page used, so it costs no extra quote call
  and cannot disagree with the screen. It is rate-limited at 10/minute per user for that reason.
- Findings are inserted in one statement, capped at 1000.
- Logs carry counters only: no symbol, no balance, no portfolio figure.

## What phase 19 deliberately did not build

- **A broker-account table.** Reconciliation is per-portfolio and import already targets one. An
  account entity would need CRUD, ownership and a UI to answer the question `source_label` answers.
  It earns a table the day a portfolio genuinely holds two accounts.
- **A separate cash-ledger table.** `cash_transactions` *is* the ledger; it needed more kinds, not a
  replacement.
- **Transfer records.** Re-parenting is the correct mechanism; synthesised transfer rows are exactly
  where fake P&L would come from.
- **A correction/versioning system.** The trigger makes every write auditable, including the ones
  written before this phase existed.
- **Automatic anything.** No scheduled job applies an adjustment, resolves a finding or corrects a
  transaction.
