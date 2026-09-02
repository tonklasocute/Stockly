# Production runbook

What to do, and in what order. Written to be readable at 3am by someone who did not write the code.

Related: [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md) before a first launch,
[DISASTER-RECOVERY.md](DISASTER-RECOVERY.md) when data is at risk.

---

## 1. Deploy

```bash
npm ci
npm run verify          # lint · typecheck · test · build — exactly what CI runs
```

Then push the branch and open a pull request. CI runs the same four steps plus a dependency audit
and a secret scan, and Vercel builds a preview.

Before promoting a preview to production:

```bash
# 1. Migrations. Apply to the production database FIRST, before the code that needs them.
supabase db push --db-url "$PRODUCTION_DB_URL"

# 2. Smoke-test the preview.
E2E_BASE_URL=https://<preview>.vercel.app npx playwright test tests/e2e/smoke.spec.ts
```

Then promote in the Vercel dashboard, or merge to `main`.

**Migrations go before code, always.** Every migration in this repository is additive, so the old
code keeps working against the new schema for the minutes between the two. The reverse order —
code first — means a request arrives for a column that does not exist yet.

### If a `check` constraint refuses to be added

A migration that adds a constraint fails if any existing row violates it, and that row is the bug the
constraint closes. Phase 9's constraints are on values that have defaulted correctly since the first
migration, so this should not happen — but if it does, find the rows before deciding anything:

```sql
select id, market from public.transactions where market not in ('US', 'SET');
select id, currency from public.portfolios
  where currency not in ('USD','THB','EUR','GBP','JPY','SGD','HKD');
select id, currency from public.dividends
  where currency not in ('USD','THB','EUR','GBP','JPY','SGD','HKD');
select id, currency from public.cash_transactions
  where currency not in ('USD','THB','EUR','GBP','JPY','SGD','HKD');
```

Correct the rows with the owner's agreement — never by guessing a market or a currency, which would
silently redenominate money someone actually spent. Then re-run the migration.

## 2. Smoke test after a production deploy

```bash
BASE=https://your-domain

curl -fsS  $BASE/api/health              # {"status":"ok","version":"…"}
curl -fsS  $BASE/api/ready               # {"status":"ready","checks":{"database":{"ok":true}}}
curl -fsSI $BASE/login | grep -i content-security-policy
curl -fsS  $BASE/robots.txt | head -3
```

Then in a browser, signed in: dashboard loads with a number on it · a stock page shows a price ·
the screener returns rows or an honest "no matches" · the AI page answers or says it is off.

Or run it: `E2E_BASE_URL=$BASE npx playwright test tests/e2e/smoke.spec.ts`.

## 3. Roll back

**Code.** Vercel keeps every deployment. Promote the previous one from the dashboard, or:

```bash
vercel rollback <previous-deployment-url>
```

It takes seconds and needs no rebuild. Find the commit behind a deployment in the Vercel dashboard,
or from `/api/health`, which reports `APP_VERSION`.

**Database.** Migrations here are **forward-only**. There are no `down` scripts, on purpose: a
half-applied rollback of a schema that already has rows in it is worse than the problem it is
solving. To undo a schema change, write a new migration that reverses it and deploy that.

The practical consequence: because every migration so far is additive, rolling code back without
touching the database is always safe. Keep it that way — a migration that drops or renames a column
breaks that property and needs a two-step deploy (add and backfill, ship code, remove later).

## 4. Turn something off

Every switch below takes effect on the next request after the environment variable changes and the
deployment redeploys. None requires a code change.

| Switch | Effect |
|---|---|
| `AI_ENABLED=false` | The assistant returns "temporarily unavailable"; the AI page and the stock-page panel say it is off; the natural-language screener box disappears. **Nothing else changes.** |
| `MARKET_DATA_PROVIDER=mock` | Stops all upstream spend instantly. Prices become fixed and obviously fake. Use when a provider bill is running away, not as a routine state. |
| `CRON_SECRET` unset | The scheduled endpoint rejects **every** request, including Vercel's. Alerts stop firing and snapshots stop refreshing. An unset secret is never open access. |
| Remove the cron entry from `vercel.json` | Same effect, and survives an environment change. |
| `AI_DAILY_LIMIT=0` | Effectively disables AI while leaving the UI in place. |
| `CSP_MODE=report-only` | Stops the policy blocking anything while still reporting. **Temporary only** — see §7. |
| `LOG_LEVEL=debug` | Verbose logs. Costs money at volume; turn it back to `info` when finished. |

## 5. Read the logs

Vercel → the project → Logs. Every line is one JSON object:

```json
{"timestamp":"…","level":"error","service":"stockly","event":"api.error",
 "requestId":"iad1::abc-123","route":"/api/portfolios","status":500,"latencyMs":812}
```

Filter by `event`:

| Event | Meaning |
|---|---|
| `api.request` | one request: route, status, latency |
| `api.error` | an unhandled error — the message is here and nowhere else |
| `market-data.error` | a provider failure, with its code |
| `ai.request` | one AI call: intent, model, tokens, latency, coverage |
| `ai.error` | an AI failure code |
| `ready.database` | the readiness probe could not reach Postgres |
| `[cron:alerts]` | one scheduled run: counters only |

A user reporting a failure will have a **reference id** on the error card. That is `requestId`;
search for it and every line from that request is together.

Logs never contain a password, a token, an API key, an AI prompt or answer, or a portfolio figure.
If you find one, that is a bug — fix the call site, not the redaction list.

## 6. Incidents

### The site is down

1. `curl $BASE/api/health`. If it answers, the platform is fine and the problem is narrower.
2. Vercel status page. If the platform is degraded, wait — there is nothing to do.
3. If health fails and Vercel is fine, roll back to the previous deployment (§3). Diagnose after.

### High error rate

1. Filter logs for `event:api.error`. One route or all of them?
2. One route → look at what changed in it; roll back if the deploy is recent.
3. All routes → check `/api/ready`. If the database check fails, it is Supabase; go to §6 "Database
   down".

### Database down or unreachable

- `/api/ready` returns 503 with `checks.database.ok: false`.
- Symptoms: every page renders the error boundary; every API call returns `INTERNAL_ERROR`.
- Check the Supabase dashboard for the project's status and, if it is a paid plan, its connection
  and disk usage.
- **There is no fallback.** Postgres is the one hard dependency. The correct action is to wait for
  Supabase, or restore (see [DISASTER-RECOVERY.md](DISASTER-RECOVERY.md)).
- Do **not** disable RLS or switch the app to the service-role key to "get it working".

### Market data provider down or rate-limited

- Symptom: `market-data.error` in the logs with `MARKET_DATA_UNAVAILABLE` or
  `MARKET_DATA_RATE_LIMITED`. Portfolio pages show a banner and price at cost basis.
- **This is handled.** The app is designed to keep working. No action is required for a short
  outage.
- If it persists: check the provider's status and your quota. Switching to
  `MARKET_DATA_PROVIDER=mock` stops the errors but replaces real prices with fake ones — only do
  that if the noise is worse than the wrongness, and tell users.
- Alerts deliberately do not fire on stale data, so a provider outage means no alerts. That is
  correct behaviour, not a second incident.

### AI failing or expensive

1. `event:ai.error` gives the code. `AI_RATE_LIMITED` and `AI_UNAVAILABLE` are the provider;
   `AI_INVALID_RESPONSE` is a model returning unusable JSON twice.
2. Cost: query the ledger.
   ```sql
   select date_trunc('day', created_at) as day,
          count(*)                       as requests,
          sum(input_tokens + output_tokens) as tokens,
          round(sum(estimated_cost), 2)  as usd
   from ai_usage group by 1 order by 1 desc limit 14;
   ```
3. Lower `AI_DAILY_LIMIT`, or set `AI_ENABLED=false`. Nothing else in the app is affected.

### Alerts not firing

1. Is the cron running? Vercel → the project → Cron Jobs. Look for recent invocations.
2. Is `CRON_SECRET` set in the production environment? If not, the endpoint rejects Vercel's own
   scheduler, silently and by design.
3. Check the last run's log line: `[cron:alerts]` carries counters for snapshots, evaluations and
   the retention sweep.
4. Manually:
   ```bash
   curl -H "x-cron-secret: $CRON_SECRET" $BASE/api/cron/alerts
   ```
5. Remember an alert fires on a **crossing**, not a comparison. A price that was already above the
   target when the alert was created does not fire until it goes below and comes back.

### Authentication broken

- Everyone redirected to `/login` in a loop → the middleware cannot reach Supabase Auth, or
  `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY` are wrong for this environment.
- Nobody can sign in but sessions work → Supabase Auth is degraded. Check its status.
- Sign-in works and then immediately signs out → cookie problem. Confirm the deployment is HTTPS;
  session cookies are `Secure` in production and a browser silently drops them over HTTP.

### A page is blank with console errors about CSP

The nonce-based policy is blocking a script. Almost always this means a page became statically
prerendered again: build-time HTML has no nonce, the header does.

1. Immediate: `CSP_MODE=report-only`, redeploy. The page works again and violations are reported.
2. Find it: `npm run build` and look for `○` next to a route that renders scripts.
3. Fix: `export const dynamic = "force-dynamic"` on that route, as in `app/(auth)/layout.tsx`.
4. Put `CSP_MODE` back to `enforce`. `tests/e2e/smoke.spec.ts` asserts every inline script is nonced
   — run it before you finish.

## 7. Routine maintenance

| When | What |
|---|---|
| Every deploy | `npm run verify`, then the smoke test |
| Weekly | Skim `event:api.error`; check the AI cost query if AI is on |
| Monthly | `npm audit`, `npm outdated`; confirm a backup restores (see DISASTER-RECOVERY) |
| After a schema change | Regenerate `types/database.ts` |
| Quarterly | Re-read [PRODUCTION-CHECKLIST.md](PRODUCTION-CHECKLIST.md) end to end |

## 8. Data integrity checks

The composite foreign keys added in `20260901060000_production_hardening.sql` make the first two
impossible going forward. Run them once against a database that predates it:

```sql
-- Child rows pointing at another user's portfolio. Expect zero.
select 'transactions' as t, count(*) from transactions x
  join portfolios p on p.id = x.portfolio_id where p.user_id <> x.user_id
union all select 'dividends', count(*) from dividends x
  join portfolios p on p.id = x.portfolio_id where p.user_id <> x.user_id
union all select 'cash_transactions', count(*) from cash_transactions x
  join portfolios p on p.id = x.portfolio_id where p.user_id <> x.user_id;

-- Tables that should have RLS enabled and do not. Expect zero rows.
select tablename from pg_tables
where schemaname = 'public'
  and tablename not in (select tablename from pg_tables where rowsecurity)
;
```
