import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The phase 15 migration's ownership and safety properties, asserted against its text.
 *
 * The same structural approach as `sharing-policies.test.ts`, and for the same reason: nobody
 * deletes a policy on purpose, but a later migration that rewrites one of these tables might not
 * bring it along.
 */

const SQL = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20260907000000_personalization.sql"),
  "utf8",
)
const FLAT = SQL.replace(/[ \t]+/g, " ")

const TABLES = ["user_preferences", "tags", "holding_tags", "saved_views"]

describe("ownership", () => {
  for (const table of TABLES) {
    it(`enables row level security on ${table}`, () => {
      expect(FLAT).toContain(`alter table public.${table} enable row level security`)
    })
  }

  it("scopes every policy to the session's own user", () => {
    expect(SQL).toContain("(select auth.uid()) = user_id")
    // Nothing here is readable by anyone else — no public policy, no `using (true)`.
    expect(SQL.includes("using (true)")).toBe(false)
    expect(SQL.includes("to anon")).toBe(false)
  })

  it("ties a holding tag to a portfolio the same user owns", () => {
    // The composite key is the guarantee: a request body naming somebody else's portfolio cannot
    // produce a row, whatever the handler does.
    expect(SQL).toContain(
      "foreign key (portfolio_id, user_id) references public.portfolios (id, user_id) on delete cascade",
    )
  })

  it("gives holding tags no update policy, because an assignment is created or removed", () => {
    const updates = SQL.split(";").filter(
      (statement) => statement.includes("on public.holding_tags") && statement.includes("for update"),
    )
    expect(updates).toEqual([])
  })
})

describe("personalization cannot delete money", () => {
  it("never references transactions", () => {
    expect(SQL.includes("public.transactions")).toBe(false)
  })

  it("lets a deleted portfolio clear a default without deleting the preference row", () => {
    // `on delete set null`, not cascade: deleting a portfolio must not delete somebody's theme.
    expect(FLAT).toContain(
      "default_portfolio_id uuid references public.portfolios (id) on delete set null",
    )
  })
})

describe("bounds", () => {
  it("caps every jsonb document, so a preference row cannot become a payload", () => {
    for (const column of [
      "favorite_metrics",
      "dashboard_layout",
      "dismissed_insights",
      "pinned_items",
      "recent_items",
    ]) {
      expect(SQL.includes(`${column}::text) <=`), column).toBe(true)
    }
  })

  it("requires every document to be an array", () => {
    const arrays = SQL.match(/jsonb_typeof\([a-z_]+\) = 'array'/g)
    expect(arrays?.length).toBe(5)
  })

  it("restricts theme, density and tag colour to known values", () => {
    expect(SQL).toContain("theme in ('system', 'light', 'dark')")
    expect(SQL).toContain("density in ('comfortable', 'compact')")
    expect(SQL).toContain("color in ('slate', 'blue', 'green', 'amber', 'red', 'violet', 'teal', 'pink')")
  })

  it("keeps a tag name unique per user, case-insensitively", () => {
    // Otherwise "Growth" and "growth" both exist and quietly split a group in two.
    expect(SQL).toContain("create unique index tags_name_ci_idx on public.tags (user_id, lower(name))")
  })
})

describe("the watchlist was extended rather than replaced", () => {
  it("adds two nullable-by-default columns to the existing table", () => {
    // The statement spans lines in the file; normalise whitespace before matching it.
    const oneLine = SQL.replace(/\s+/g, " ")
    expect(oneLine).toContain("alter table public.watchlist_items add column sort_order integer")
    expect(oneLine).toContain("add column pinned boolean not null default false")
  })

  it("creates no second watchlist table", () => {
    expect(SQL.includes("create table public.watchlists")).toBe(false)
    expect(SQL.includes("create table public.watchlist_views")).toBe(false)
  })
})
