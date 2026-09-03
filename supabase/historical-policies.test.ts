import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The phase 16 migration's safety properties, asserted against its text.
 *
 * Same structural approach as the sharing and personalization policy tests: nobody removes a
 * constraint on purpose, but a later migration that rewrites one of these tables might not bring
 * it along.
 */

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260908000000_historical_intelligence.sql"),
  "utf8",
)
const FLAT = SQL.replace(/\s+/g, " ")

describe("snapshots record their own reliability", () => {
  it("stamps a quality and a calculation version on every row", () => {
    expect(FLAT).toContain("add column quality text not null default 'COMPLETE'")
    expect(FLAT).toContain("add column calculation_version integer not null default 1")
  })

  it("forces quality and the missing count to agree", () => {
    // A COMPLETE row cannot be missing anything, and a constraint is the only way to guarantee the
    // two columns never drift apart.
    expect(FLAT).toContain("check ((quality = 'COMPLETE') = (missing_holdings = 0))")
  })

  it("restricts quality and source to known values", () => {
    expect(SQL).toContain("quality in ('COMPLETE', 'PARTIAL', 'STALE')")
    expect(SQL).toContain("source in ('PAGE_VIEW', 'SCHEDULED', 'BACKFILL')")
  })

  it("creates no second snapshot table", () => {
    // `portfolio_snapshots` has existed since phase 3. A parallel one would be two answers to
    // "what was it worth in March".
    expect(SQL.includes("create table public.portfolio_snapshots")).toBe(false)
    expect(SQL.includes("create table public.historical_snapshots")).toBe(false)
  })
})

describe("historical exchange rates", () => {
  it("are keyed by pair and date, which is what makes the job idempotent", () => {
    expect(FLAT).toContain("primary key (base, quote, rate_date)")
  })

  it("refuse an impossible rate rather than valuing a portfolio at nothing", () => {
    expect(SQL).toContain("check (rate > 0)")
  })

  it("refuse a rate dated in the future", () => {
    expect(FLAT).toContain("check (rate_date <= (now() at time zone 'utc')::date)")
  })

  it("refuse a pair of the same currency", () => {
    expect(SQL).toContain("base <> quote")
  })

  it("record which source said so, so a correction can be traced", () => {
    expect(SQL).toContain("source in ('PROVIDER', 'MANUAL')")
  })
})

describe("reference data is readable, not writable", () => {
  it("enables RLS and grants only select", () => {
    expect(FLAT).toContain("alter table public.fx_rates_daily enable row level security")
    expect(SQL).toContain('create policy "fx rates are readable by signed-in users"')
    expect(SQL).toContain("for select using ((select auth.uid()) is not null)")
  })

  it("has no insert, update or delete policy at all", () => {
    // RLS denies what it does not permit, so a request cannot write a rate however authenticated.
    for (const verb of ["for insert", "for update", "for delete"]) {
      const policies = SQL.split(";").filter(
        (statement) => statement.includes("on public.fx_rates_daily") && statement.includes(verb),
      )
      expect(policies, verb).toEqual([])
    }
  })

  it("is never granted to an anonymous role", () => {
    expect(SQL.includes("to anon")).toBe(false)
  })
})

describe("the migration touches no money", () => {
  it("never references transactions", () => {
    expect(SQL.includes("public.transactions")).toBe(false)
  })

  it("stores no return, contribution or drawdown", () => {
    // All three are derived on read, so correcting a transaction corrects the history rather than
    // leaving a stale reading behind.
    for (const column of ["contribution", "drawdown", "return_pct", "attribution"]) {
      expect(SQL.toLowerCase().includes(`${column} numeric`), column).toBe(false)
    }
  })
})
