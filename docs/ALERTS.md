# Alerts and notifications

How Stockly decides that something happened, and how it tells you. Every rule below is implemented
in [`domain/alerts.ts`](../domain/alerts.ts) and proved in `domain/alerts.test.ts`.

---

## 1. The three things, kept separate

```
Alert rule          "NVDA above $200"          alerts
      ↓
Alert event         "crossed at $200.10"       alert_events
      ↓
Notification        "NVDA rose above $200"     notifications  →  in-app + push
```

A rule is a standing instruction. An event is a fact that happened once. A notification is a message
about it. Collapsing them would mean a rule that cannot be disabled without losing its history, and a
delivery failure that loses the fact that the alert fired at all.

---

## 2. Alert types

| Type | Measures | Target |
|---|---|---|
| `PRICE_ABOVE` / `PRICE_BELOW` | last traded price | currency |
| `PERCENT_CHANGE_ABOVE` / `_BELOW` | change since **previous close** | percent |
| `PORTFOLIO_DAILY_CHANGE_ABOVE` / `_BELOW` | portfolio change since previous close | percent |
| `PORTFOLIO_TOTAL_RETURN_ABOVE` / `_BELOW` | portfolio return since purchase | percent |
| `POSITION_WEIGHT_ABOVE` / `_BELOW` | one holding's share of the portfolio | percent |
| `DIVIDEND_RECEIVED` | a dividend row being written | — |
| `RSI_ABOVE` / `RSI_BELOW` | RSI(14) | index |
| `ADX_ABOVE` | ADX(14) | index |
| `RELATIVE_VOLUME_ABOVE` | volume ÷ its 20-day average | multiple |
| `PRICE_ABOVE_EMA` / `PRICE_BELOW_EMA` | price distance from the 200 EMA | percent |
| `MACD_BULLISH_CROSS` / `_BEARISH_CROSS` | the crossing itself | — |
| `EMA_CROSS_BULLISH` / `_BEARISH` | the 50/200 crossing itself | — |

The technical types (phase 6) read a cached snapshot rather than a quote; see
[TECHNICAL-ANALYSIS.md](TECHNICAL-ANALYSIS.md). They use the same engine, the same crossing rule and
the same cooldown — a cross type's reading is simply 1 on the bar it happened and 0 otherwise.

**Daily change and total return are separate types on purpose.** A portfolio can be up 2% today and
down 15% since purchase; a single "gain %" would be ambiguous in the database, the API and the UI.

**Percentage change is measured against the previous close.** Fixed, and documented here because the
alternative matters: session open drifts through the day, so "+5% today" would mean something
different at 10am and at 3pm.

---

## 3. Crossing, not comparison

The bug this design exists to prevent:

```
target 200        prices 200.01, 200.03, 200.05, 200.10
current > target  →  four notifications in four minutes
```

An alert fires when the condition becomes true **having been false**. That is held in the row's
state, not by comparing two raw prices, so it also survives a missed run or a restart:

```
armed      condition currently false — waiting to be crossed
triggered  condition true and already fired — will not fire again
cooldown   fired recently — even a fresh crossing is suppressed
```

```
$195 → armed        $200.01 → TRIGGER, state = triggered
$201 → hold (still true, already fired)
$195 → armed again  $200.50 → TRIGGER
```

A price exactly equal to the target has **not** crossed it: `above` is strictly greater, `below`
strictly less.

**Editing the target resets the state.** The stored "triggered" was about the old threshold; keeping
it would swallow the first real crossing of the new one.

**A new alert whose condition is already true is stored as `triggered`, not fired.** Setting "above
$200" while NVDA trades at $250 announces nothing — the user is looking at that price right now.
It fires on the next genuine crossing.

---

## 4. Cooldown

`cooldown_minutes` (default 60) suppresses a fresh crossing that arrives too soon after the last one.
It is a second line of defence: the state machine already stops repeats while the condition holds,
and the cooldown covers a price oscillating across the threshold.

Re-arming is never suppressed — the condition going false always returns the alert to `armed`, even
inside the quiet window.

---

## 5. Guards before any evaluation

| Guard | Behaviour |
|---|---|
| disabled | skipped, rule kept |
| no reading | skipped — a symbol with no quote is not a symbol at zero |
| **stale reading** | quote older than 15 minutes → skipped and counted |
| market closed | price-derived alerts skipped; provider-reported, never inferred from a clock |
| market status unknown | evaluated — staleness is the real guard |

A holding with no weight (the symbol is not owned) has **no reading**, not a weight of 0%. Treating
absence as zero would fire every "weight below" alert for every symbol ever mentioned.

---

## 6. The scheduled job

```
/api/cron/alerts
  → load every enabled, schedule-driven alert          (one query)
  → union of their symbols → ONE batched quote call    (one request)
  → portfolios referenced → loaded once, priced from those quotes
  → evaluate each alert in memory
  → write state, insert events, deliver notifications
```

The shape that matters: **one batched call for the union of symbols.** A thousand alerts on NVDA
across a hundred users is one upstream request. The naive loop — for each user, for each alert,
fetch — turns 100 users into 10,000 calls and exhausts a free tier's minute budget on the first ten.

If market data fails, the run ends having triggered nothing. An alert must never fire from an
absence of information.

### Idempotency

`idempotency_key = alertId : minute : value`, with a unique index on it. Two concurrent runs seeing
the same crossing produce the same key; the second insert conflicts and is swallowed, so no duplicate
notification. The state machine already covers the sequential case — this covers overlap.

### Schedule

`vercel.json` requests every 5 minutes. **Vercel's Hobby plan runs cron jobs once a day**; minute-level
scheduling needs a Pro plan, or any external scheduler calling the endpoint with the secret.

> Price alerts are polled, not tick-level. A price that crosses your target and comes straight back
> between two runs may produce no notification. This is stated in the UI, not only here.

---

## 7. Security

**Cron.** A shared secret (`CRON_SECRET`) accepted from `Authorization: Bearer` (what Vercel sends)
or `x-cron-secret` (an external scheduler), compared in constant time. **An unset secret rejects
everything** — the dangerous failure mode would be an unset variable silently opening the endpoint.

**The service-role key** is used in exactly one place: this job, which must read alerts belonging to
every user and has no session to act under. It is the only RLS bypass in the app, and it is reachable
only behind the secret check.

**Everything else is RLS.** Alert and notification routes never filter by `user_id` in application
code — the policies do it, so a handler bug cannot leak another user's rows. An id belonging to
someone else updates zero rows and returns 404.

**The condition is an enum**, never a client-supplied expression. `condition: "price > 200"` would be
a query language the server has to interpret; `PRICE_ABOVE` is a closed set the database itself
constrains.

**Push payloads carry no portfolio data.** This text can appear on a locked screen:

- price and percentage moves *are* named — public market data, and a notification that will not say
  what happened is useless;
- portfolio value, return and position weight are **never** included. Those messages say "open
  Stockly to see" and link inward.

---

## 8. Spam protection

Three independent limits:

1. **Per alert** — the state machine and the cooldown.
2. **Per user per run** — at most 10 notifications; the rest are dropped, not queued. A stale price
   notification delivered later is worse than none.
3. **Per account** — at most 100 alerts, enforced against the database, which a serverless in-memory
   counter cannot be.

---

## 9. Delivery

In-app first. The row in `notifications` is the record of truth and is written even when push is
unconfigured, denied or broken — losing push must never mean losing the notification.

Push outcomes are handled by kind:

| Outcome | Action |
|---|---|
| sent | counted |
| **404 / 410** | subscription is permanently gone → **deleted**, never retried |
| other error | counted, left alone; the next alert tries again |

There is no retry queue. Repeating a price notification minutes later would deliver something that is
no longer true.

Subscriptions are unique by **endpoint**, not per user: a device handed to someone else re-subscribes
with the same endpoint and the row moves to the new owner, rather than leaving the previous owner
receiving alerts on a phone they no longer have.

---

## 10. Dividends

`DIVIDEND_RECEIVED` is the one type the job never evaluates. There is nothing to poll — the event is
a row the user just wrote — so the notification is raised from the write. Immediate, exact, and it
cannot double-fire, unlike a cron diffing the dividends table against itself every few minutes.

---

## 11. Observability

The job returns and logs a counter object: alerts considered and evaluated, triggered, skipped by
reason, notifications created, pushes sent/failed/expired, symbols fetched, portfolios priced,
duration. **Counters only — no user ids, symbols or amounts**, so the log is safe to keep and share.

---

## 12. Environment

| Variable | Required for |
|---|---|
| `CRON_SECRET` | the scheduled job — without it, every request is rejected |
| `SUPABASE_SERVICE_ROLE_KEY` | the job's database access |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | push (public by design) |
| `VAPID_PRIVATE_KEY` | push (server only) |
| `VAPID_SUBJECT` | push (`mailto:` or `https:`, per the Web Push spec) |

Generate a VAPID pair with `npx web-push generate-vapid-keys`. With them unset the app runs on in-app
notifications alone and says so in the settings UI.
