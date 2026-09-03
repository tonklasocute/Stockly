import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The phase 19 migration's safety properties, asserted against its text.
 *
 * Same structural approach as the sharing, personalization and historical policy tests. Nobody
 * removes an ownership check on purpose; a later migration that rewrites one of these tables might
 * simply not bring it along, and these are the properties that would fail silently if it did.
 */

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260911000000_portfolio_operations.sql"),
  "utf8",
)
const FLAT = SQL.replace(/\s+/g, " ")

describe("the audit trail cannot be edited", () => {
  it("is written by a trigger on both money-bearing tables", () => {
    expect(FLAT).toContain("create trigger transactions_audit after insert or update or delete on public.transactions")
    expect(FLAT).toContain("create trigger cash_transactions_audit after insert or update or delete on public.cash_transactions")
  })

  it("writes through a security definer function, so it needs no insert policy", () => {
    expect(FLAT).toContain("create or replace function public.record_financial_audit() returns trigger language plpgsql security definer")
  })

  /**
   * The whole guarantee. RLS denies what it does not permit, so the *absence* of these three
   * policies is what makes the trail immutable — which is exactly the kind of protection a later
   * migration adds back by accident.
   */
  it("grants its owner select and nothing else", () => {
    expect(FLAT).toContain('create policy "audit rows are self-readable" on public.financial_audit for select')
    for (const verb of ["insert", "update", "delete"]) {
      expect(FLAT).not.toContain(`on public.financial_audit for ${verb}`)
    }
  })

  it("has row level security enabled at all", () => {
    expect(FLAT).toContain("alter table public.financial_audit enable row level security")
  })

  it("records the row before and after rather than a diff", () => {
    expect(SQL).toContain("before       jsonb")
    expect(SQL).toContain("after        jsonb")
  })

  it("forces the two states to match the operation", () => {
    expect(FLAT).toContain("operation = 'INSERT' and before is null and after is not null")
    expect(FLAT).toContain("operation = 'DELETE' and before is not null and after is null")
  })

  /**
   * An audit row outlives what it describes. A foreign key would make the record of a deletion
   * impossible to write, because the row is already gone when the trigger fires.
   */
  it("does not reference the row it describes", () => {
    expect(FLAT).not.toContain("entity_id    uuid not null references")
    expect(FLAT).not.toContain("portfolio_id uuid references public.portfolios")
  })
})

describe("the correction and transfer functions check ownership themselves", () => {
  /**
   * `security definer` turns RLS off. These predicates are then the only thing between the
   * function and somebody else's money — this is the IDOR test.
   */
  it("scopes a correction to the caller's own transaction", () => {
    expect(FLAT).toContain("update public.transactions set symbol")
    expect(FLAT).toContain("where id = p_id and user_id = (select auth.uid())")
  })

  it("checks both portfolios belong to the caller before a transfer", () => {
    expect(FLAT).toContain("if not exists (select 1 from public.portfolios where id = p_from_portfolio and user_id = v_user) or not exists (select 1 from public.portfolios where id = p_to_portfolio and user_id = v_user)")
  })

  it("refuses a transfer from an unauthenticated caller", () => {
    expect(FLAT).toContain("if v_user is null then raise exception 'not signed in'")
  })

  it("scopes the moved rows to the caller as well as to the portfolio", () => {
    expect(FLAT).toContain("where portfolio_id = p_from_portfolio and user_id = v_user")
  })

  it("is not executable by anonymous callers", () => {
    expect(FLAT).toContain("from public; grant execute on function public.correct_transaction")
    expect(FLAT).toContain("to authenticated")
    expect(FLAT).not.toContain("to anon")
  })

  it("requires a reason, so a financial change is never unexplained", () => {
    expect(FLAT).toContain("raise exception 'a correction must state a reason'")
    expect(FLAT).toContain("raise exception 'a transfer must state a reason'")
  })

  /**
   * A transfer re-parents rows. The moment it inserts a sell and a buy instead, it books a
   * realized profit nobody made.
   */
  it("transfers by re-parenting, never by trading", () => {
    expect(FLAT).toContain("update public.transactions set portfolio_id = p_to_portfolio")
    expect(FLAT).not.toContain("insert into public.transactions")
  })
})

describe("share adjustments", () => {
  it("cannot be applied twice, which would square the ratio", () => {
    expect(FLAT).toContain("unique (portfolio_id, symbol, market, effective_date)")
  })

  it("refuse a zero on either side of the ratio", () => {
    expect(SQL).toContain("check (numerator > 0)")
    expect(SQL).toContain("check (denominator > 0)")
  })

  it("refuse a 1:1 split, which changes nothing", () => {
    expect(SQL).toContain("check (numerator <> denominator)")
  })

  it("cover splits only — nothing whose cost basis Stockly cannot derive", () => {
    expect(SQL).toContain("event_type in ('SPLIT', 'REVERSE_SPLIT')")
  })

  it("carry the composite ownership key every child table here uses", () => {
    expect(FLAT).toContain("foreign key (portfolio_id, user_id) references public.portfolios (id, user_id)")
  })

  it("do not rewrite transactions", () => {
    expect(SQL).not.toContain("update public.transactions set quantity")
    expect(SQL).not.toContain("update public.transactions set price")
  })
})

describe("reconciliation history", () => {
  it("keeps runs and items as separate tables", () => {
    expect(SQL).toContain("create table public.reconciliation_runs")
    expect(SQL).toContain("create table public.reconciliation_items")
  })

  it("uses the explicit run states, including the two that are not a clean success", () => {
    expect(FLAT).toContain("'PENDING', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'")
  })

  it("refuses to record a failure without a reason", () => {
    // A failed run represented as an empty successful one is the bug this prevents.
    expect(FLAT).toContain("check (status <> 'FAILED' or error is not null)")
  })

  /**
   * A finding must stay readable after the user acts on it and deletes the transaction it named.
   */
  it("points at a transaction without referencing it", () => {
    expect(SQL).toContain("transaction_id uuid,")
    expect(FLAT).not.toContain("transaction_id uuid references public.transactions")
  })

  it("caps every jsonb column, so a whole statement cannot land in one", () => {
    expect(FLAT).toContain("check (length(summary::text) <= 4000)")
    expect(FLAT).toContain("check (length(detail::text) <= 4000)")
  })

  it("pairs a resolution with its timestamp", () => {
    expect(FLAT).toContain("check ((resolved_at is null) = (resolution is null))")
  })

  it("scopes every table to its owner", () => {
    for (const table of ["reconciliation_runs", "reconciliation_items", "share_adjustments"]) {
      expect(FLAT).toContain(`alter table public.${table} enable row level security`)
      expect(FLAT).toContain(`on public.${table} for select using ((select auth.uid()) = user_id)`)
    }
  })
})

describe("nothing here reaches an anonymous visitor", () => {
  it("grants the anonymous role nothing at all", () => {
    expect(SQL).not.toContain("to anon")
    expect(SQL.toLowerCase()).not.toContain("using (true)")
  })
})

describe("the cash ledger only ever grows", () => {
  it("adds kinds rather than replacing the type", () => {
    for (const kind of ["fee", "tax", "interest", "transfer_in", "transfer_out", "adjustment_in", "adjustment_out"]) {
      expect(FLAT).toContain(`alter type public.cash_transaction_kind add value if not exists '${kind}'`)
    }
  })

  it("drops no enum value — that would orphan stored rows", () => {
    expect(SQL.toLowerCase()).not.toContain("drop type")
    expect(SQL.toLowerCase()).not.toContain("drop column")
  })

  /**
   * Direction and the capital-flow rule live in `domain/cash.ts`. Restating them as a constraint
   * here would create a second place for them to drift.
   */
  it("does not restate the direction rule as a constraint", () => {
    // Referring to the domain constant in a comment is fine; encoding it here is not.
    expect(FLAT).not.toContain("check (kind in ('deposit'")
    expect(FLAT).not.toMatch(/check \([^)]*kind[^)]*'transfer_in'/)
  })
})

describe("the migration is additive", () => {
  it("destroys nothing", () => {
    const lowered = SQL.toLowerCase()
    for (const destructive of ["drop table", "drop policy", "truncate", "delete from"]) {
      expect(lowered).not.toContain(destructive)
    }
  })
})
