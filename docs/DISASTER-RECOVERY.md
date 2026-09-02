# Disaster recovery

What is at risk, how it is protected, and how to get it back.

The short version: **Stockly stores one irreplaceable thing — the transactions a user typed in.**
Everything else is derived, cached or re-fetchable. That single fact shapes every decision below.

---

## 1. What would actually be lost

| Data | Irreplaceable? | If it is gone |
|---|---|---|
| `transactions` | **Yes** | Cost basis, holdings and P&L are gone. Nothing can reconstruct them; they were typed in from a broker statement. |
| `dividends`, `cash_transactions` | **Yes** | Same. |
| `portfolios` | Yes, but trivially recreated | A name and a currency. |
| `watchlist_items`, `alerts`, `saved_screens` | Annoying | Minutes to recreate, from memory. |
| `ai_conversations`, `ai_messages` | No | Research notes. Re-askable. |
| `portfolio_snapshots` | Partially | The performance chart's history. Cannot be rebuilt — it is a record of what the portfolio was worth on a day. Every other figure survives without it. |
| `notifications`, `alert_events` | No | A log of things that already happened. |
| `technical_snapshots` | No | Shared reference data, rebuilt by the next scheduled runs. |
| `ai_usage` | No, but it is the cost ledger | Historical spend visibility. |
| Prices, indicators, quotes | No | Never stored. Re-fetched on demand. |
| Auth users | **Yes** | Handled by Supabase Auth and covered by its backups. |

**A user's own protection:** Analytics → Export produces CSV of transactions, dividends and cash.
Encourage it. It is the only copy that survives losing the whole platform, and it is the reason the
export exists.

---

## 2. Objectives

Stated for what this actually is — a personal portfolio tracker on a managed database, not a
payments system:

| | Target | Why |
|---|---|---|
| **RPO** (data loss) | ≤ 24 h on the free tier · ≤ 5 min with point-in-time recovery | Free-tier Supabase takes a daily backup. A day of lost transactions is a handful of rows a user can retype from a broker statement. If that is not acceptable, PITR is a paid upgrade and the only thing that changes it. |
| **RTO** (downtime) | ≤ 1 h for a database restore · ≤ 5 min for a code rollback | A code rollback is promoting a previous Vercel deployment. A restore is a Supabase operation plus a redeploy. |

These are honest numbers for the current configuration. **Do not claim better without buying PITR
and testing a restore.**

---

## 3. Backups

**Database — Supabase.**

- Free tier: daily automatic backups, retained ~7 days. No point-in-time recovery.
- Pro tier and above: daily backups plus PITR, retained 7–30 days depending on plan.
- Verify in the Supabase dashboard → Database → Backups that backups are actually listed. A backup
  policy nobody has looked at is a hope, not a backup.

**An independent copy.** Managed backups live in the same account as the thing they protect. A
logical dump held elsewhere is what survives losing the account:

```bash
# Schema and data. Run from a machine that is not the production environment.
pg_dump "$PRODUCTION_DB_URL" \
  --schema=public --no-owner --no-privileges \
  --file="stockly-$(date +%Y%m%d).sql"

gzip "stockly-$(date +%Y%m%d).sql"
```

Store it encrypted, off-platform, and delete copies older than the retention you have decided on.
**A dump of this database contains every user's financial records** — treat it exactly as seriously
as the production database itself.

**Code and schema.** Git. Every migration is a file in `supabase/migrations/`, forward-only and
never edited after being applied. That directory is the schema's source of truth, not the Supabase
dashboard.

**Secrets.** Not in git, and not in a backup. Keep a copy of the environment variables in a password
manager — a restored database with no `SUPABASE_SERVICE_ROLE_KEY` is a restored database nobody can
run the scheduled job against.

---

## 4. Recovery

### The database is corrupted or data was deleted

1. **Stop writes.** Set the Vercel deployment to a maintenance state, or remove the cron entry so
   the scheduled job is not writing into a database you are about to replace.
2. Supabase dashboard → Database → Backups → restore the most recent good point.
3. Wait for the restore. This is the RTO.
4. Confirm the schema is at the expected version:
   ```sql
   select count(*) from supabase_migrations.schema_migrations;
   ```
   If the restore predates a migration, apply the missing ones: `supabase db push`.
5. Run the integrity queries in [PRODUCTION-RUNBOOK.md](PRODUCTION-RUNBOOK.md) §8.
6. Redeploy, then smoke-test.
7. Tell users the window that was lost. Anything they entered inside it is gone and only they know
   what it was.

### The whole Supabase project is gone

1. Create a new project.
2. Apply every migration in order: `supabase db push`.
3. Restore data from the most recent `pg_dump` (§3).
4. Update `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY` in Vercel, then redeploy.
5. **Auth users are a separate problem.** A `pg_dump` of `public` does not include `auth.users`.
   Without the auth schema, every `user_id` in the restored data references a user that no longer
   exists and nobody can sign in to reach their own records. Either restore the auth schema too, or
   accept that users must re-register and their rows must be re-pointed by hand.
   *This is the scenario worth rehearsing, because it is the one that quietly does not work.*

### A bad migration reached production

Migrations are forward-only. Do not attempt a manual reverse on a table with rows in it.

1. If the migration was additive (every one so far is), roll the **code** back and leave the schema
   alone. The old code ignores the new column.
2. If it was destructive, restore from backup to just before it (§4.1) and write a corrected
   migration.
3. Never edit a migration file that has been applied anywhere shared. Write a new one.

### A deployment is broken

Not a disaster — see [PRODUCTION-RUNBOOK.md](PRODUCTION-RUNBOOK.md) §3. Promote the previous Vercel
deployment. Seconds, no rebuild, no database involvement.

### A secret leaked

1. Rotate it at the source first: Supabase (anon and service-role), the market-data provider, the AI
   provider, `CRON_SECRET`, VAPID keys.
2. Update Vercel's environment variables and redeploy.
3. If `SUPABASE_SERVICE_ROLE_KEY` leaked, assume every row was readable. Rotate immediately, then
   review Supabase's logs for the exposure window.
4. If a key reached git history, rotating is not enough on its own — the history must be rewritten
   or the repository treated as public. `gitleaks` runs in CI to make this a very unlikely first
   discovery.

---

## 5. Test the restore

A backup that has never been restored is a belief.

**Quarterly, or before any schema change big enough to worry about:**

1. Create a scratch Supabase project.
2. Restore the most recent dump into it.
3. Point a local build at it: `npm run build && npm start`.
4. Sign in as a test user; confirm a portfolio's total matches what production showed.
5. Delete the scratch project.
6. Write down the date and how long step 2 took. That number is your real RTO.

---

## 6. What is deliberately not protected

- **Prices and indicators.** Never stored; re-fetched. `technical_snapshots` rebuilds itself.
- **AI conversations older than 180 days,** and usage rows older than 365. Deleted by design.
- **Service worker caches.** Per device, holding nothing authenticated.
- **The in-memory rate limiter.** Resets on every cold start, and is documented as advisory.

---

## 7. Recovering from a change rather than a loss

Sections 1–6 are about losing the database. Far more likely is a change somebody regrets, and those
recover differently — usually without touching a backup at all, because Stockly's write paths were
built so the damaging operations are reversible.

### An import created the wrong transactions

The rows are ordinary transactions carrying `import_session_id` and `source_row`, so the import is
addressable:

```sql
-- What did this import create?
select id, symbol, side, trade_date, quantity, price
  from public.transactions
 where import_session_id = '<session-id>'
 order by source_row;

-- Reverse it. Deletes transactions, which is what an import created and nothing else.
delete from public.transactions where import_session_id = '<session-id>';
```

Deleting the **session** does not do this: the foreign key is `on delete set null`, deliberately, so
that removing a history row can never remove money. Reversing an import means deleting transactions,
knowingly.

Re-importing the same file afterwards works: the fingerprints went with the rows, so the partial
unique index no longer blocks them.

### A transaction was edited or deleted by mistake

There is no soft delete and no audit trail on `transactions` — a decision worth restating here
because it is the one place it costs something. Recovery is point-in-time restore (§4) or re-entry
by hand from the broker statement. For a single row, re-entry is almost always faster and is what
the reconciliation feature exists to verify afterwards: import the broker's file and let
`MISSING_IN_STOCKLY` tell you what is absent.

### A portfolio's base currency was changed

Stored snapshot rows keep the currency they were taken in and the analytics pass reads only those
matching the current base currency, so switching back restores the old series intact. Nothing is
lost and nothing needs recovering — the rows for the other currency are still there and still true.

### Sharing was left on by accident

Two independent switches, either of which closes the door immediately:

```sql
-- Stop publishing one portfolio. The settings survive; the page does not.
delete from public.published_shares where portfolio_id = '<portfolio-id>';

-- Stop every shared page in the deployment. Pages only; no portfolio is touched.
delete from public.published_shares;

-- Revoke every share link for one portfolio.
update public.portfolio_share_links
   set revoked_at = now()
 where portfolio_id = '<portfolio-id>' and revoked_at is null;
```

Nothing shared is cached, so all three take effect on the next request.

### A migration went wrong

Migrations are forward-only and additive, which is what makes this survivable: application code can
always roll back without touching the schema, so the first move is **redeploy the previous version**
and leave the database alone. A migration that has already run and needs undoing is a new migration
that reverses it, never an edit to the applied file — editing a file that has run on a shared
environment leaves two environments with the same migration name and different contents.

A destructive change (a dropped column, a narrowed type) needs a two-step deploy: ship the code that
stops using it, confirm, then ship the migration. There is no destructive migration in the history
so far.

## 8. What has and has not been rehearsed

- **Not rehearsed:** a restore, in any environment. §5 says how, and the number it produces is the
  only real RTO. Everything in §2 is an estimate until then.
- **Not rehearsed:** the import reversal above, against production data.
- **Verified by test, not by execution:** the migrations, including phase 13's policies, which are
  asserted structurally by `supabase/sharing-policies.test.ts` rather than applied to a database in
  the development environment.
